# REST API Reference: NovaUser D1 Wrapper
This document provides full specifications of the Hono-based D1 REST API to assist in designing k6 performance test scripts.

* **Production Base URL**: `https://k6demo.manig.dev`
* **Content-Type**: `application/json`
* **Authentication**: None (Public access for load testing)

---

## 1. API Endpoint Specification

### POST `/users`
Creates a new user record in the Cloudflare D1 SQLite database.

* **Method**: `POST`
* **Route**: `/users`
* **Request Headers**:
  ```http
  Content-Type: application/json
  ```
* **Request JSON Payload**:
  * `name` (string, required): Full name of the user. Must be a non-empty string.
  * `email` (string, required): Email address. Allows duplicates to support load-test generation. Must be valid email format.
  * `role` (string, required): Privileges of the user. Supported options: `Admin`, `Editor`, `Viewer`.
  ```json
  {
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "role": "Viewer"
  }
  ```
* **Success Response (201 Created)**:
  * Returns the newly generated, cryptographically secure UUID:
  ```json
  {
    "id": "e0e271a3-fb11-49b0-9889-fa6b3060a80e"
  }
  ```
* **Error Responses**:
  * **400 Bad Request** (Missing/Empty Fields or Invalid JSON):
    ```json
    { "error": "Field \"role\" is required and must be a non-empty string" }
    ```
  * **500 Internal Server Error** (D1 database failure):
    ```json
    { "error": "Database write error" }
    ```

---

### GET `/users/:id`
Fetches a user record matching the specified unique ID parameter.

* **Method**: `GET`
* **Route**: `/users/:id`
* **Route Parameter**:
  * `id` (string, required): The secure UUID generated on user creation.
* **Success Response (200 OK)**:
  ```json
  {
    "id": "e0e271a3-fb11-49b0-9889-fa6b3060a80e",
    "name": "Jane Doe",
    "email": "jane.doe@example.com",
    "role": "Viewer"
  }
  ```
* **Error Responses**:
  * **404 Not Found** (ID does not exist in D1):
    ```json
    { "error": "User not found" }
    ```

---

### PATCH `/users/:id`
Dynamically updates only the specified fields for a user record.

* **Method**: `PATCH`
* **Route**: `/users/:id`
* **Route Parameter**:
  * `id` (string, required): The secure UUID of the target record.
* **Request JSON Payload**:
  * *Must contain at least one optional field below:*
  * `name` (string, optional): Updated name.
  * `email` (string, optional): Updated email.
  * `role` (string, optional): Updated role (`Admin`, `Editor`, `Viewer`).
  ```json
  {
    "role": "Editor"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true
  }
  ```
* **Error Responses**:
  * **400 Bad Request** (No fields provided, or provided fields contain invalid types):
    ```json
    { "error": "At least one field (\"name\", \"email\", or \"role\") must be provided for update" }
    ```
  * **404 Not Found** (ID does not exist in D1):
    ```json
    { "error": "User not found" }
    ```

---

### GET `/users` (Helper Directory Listing)
Helper endpoint to scan user records. Very useful for fetching active user IDs during performance scripts.

* **Method**: `GET`
* **Route**: `/users`
* **Query Parameters (Optional)**:
  * `search` (string): Filters records where `name` or `email` contains the substring.
  * `role` (string): Filters records by role (`Admin`, `Editor`, `Viewer`).
* **Success Response (200 OK)**:
  * Returns an array of matched users (limit: 100):
  ```json
  [
    {
      "id": "e0e271a3-fb11-49b0-9889-fa6b3060a80e",
      "name": "Jane Doe",
      "email": "jane.doe@example.com",
      "role": "Viewer"
    }
  ]
  ```

---

## 2. K6 Integration Snippets (Self-Contained Examples)

### Scenario A: Full Lifecycle Stress Script (POST -> GET -> PATCH)
This script models a realistic user session: creating a record, querying it to verify persistence, and updating access privileges.

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // Typical ramping profile for Cloudflare Worker & D1
  stages: [
    { duration: '30s', target: 50 },  // Ramp up
    { duration: '1m', target: 100 },  // Maintain
    { duration: '15s', target: 0 },   // Scale down
  ],
  thresholds: {
    // Assert 95% of responses complete under 100ms
    http_req_duration: ['p(95)<100'],
    // Assert less than 1% request failures
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = 'https://k6demo.manig.dev';

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  
  // 1. POST Request: Create User
  const postPayload = JSON.stringify({
    name: `K6_User_${__VU}_${__ITER}`,
    email: `k6_tester_${__VU}_${__ITER}@loadtest.com`,
    role: 'Viewer'
  });
  
  const postRes = http.post(`${BASE_URL}/users`, postPayload, { headers });
  
  const postSuccess = check(postRes, {
    'post status is 201': (r) => r.status === 201,
    'post has id': (r) => r.json('id') !== undefined,
  });

  if (postSuccess) {
    const userId = postRes.json('id');

    // 2. GET Request: Query created ID
    const getRes = http.get(`${BASE_URL}/users/${userId}`);
    check(getRes, {
      'get status is 200': (r) => r.status === 200,
      'get matched email': (r) => r.json('email').includes('@loadtest.com'),
    });

    // 3. PATCH Request: Dynamically update role
    const patchPayload = JSON.stringify({
      role: 'Admin'
    });
    
    const patchRes = http.patch(`${BASE_URL}/users/${userId}`, patchPayload, { headers });
    check(patchRes, {
      'patch status is 200': (r) => r.status === 200,
      'patch success field true': (r) => r.json('success') === true,
    });
  }

  sleep(0.2); // Sleep 200ms between VU iterations
}
```

### Scenario B: Negative Validation Testing
Validates error boundary behavior under load.

```javascript
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = 'https://k6demo.manig.dev';

export default function () {
  const headers = { 'Content-Type': 'application/json' };

  // Test 1: POST missing email
  const badPost = http.post(`${BASE_URL}/users`, JSON.stringify({ name: 'ErrorName', role: 'Viewer' }), { headers });
  check(badPost, {
    'post validation returns 400': (r) => r.status === 400,
    'post error returned': (r) => r.json('error') !== undefined,
  });

  // Test 2: GET non-existent UUID
  const badGet = http.get(`${BASE_URL}/users/00000000-0000-0000-0000-000000000000`);
  check(badGet, {
    'get invalid UUID returns 404': (r) => r.status === 404,
    'get user not found message': (r) => r.json('error') === 'User not found',
  });
}
```
