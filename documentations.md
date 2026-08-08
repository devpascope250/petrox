BASE URL: https://petrox.quicko.rw/api/v1

### for user 
GET:   /users
POST: /users
GET: /users/:id

## for Authentications

POST: /auth/login 
{ accessToken: string, refreshToken: string, expiresAt:Date, user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
}, permissions: string[] }
POST: /auth/pin-login
POST: /auth/refresh
POST: /auth/logout
POST: /auth/password-reset/request"
POST: /auth/password-reset/confirm"

### for sidebar
GET: /modules/sidebar
