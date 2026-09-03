import jwt from "@fastify/jwt";
import fp from "fastify-plugin";

export default fp(async (app) => {
  await app.register(jwt, {
    secret: app.config.JWT_SECRET,
    cookie: { cookieName: "access_token", signed: false },
    // Protected routes accept the access token only from the HTTP-only cookie.
    verify: { onlyCookie: true }
  });
}, { name: "jwt" });
