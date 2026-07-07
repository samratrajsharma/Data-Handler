import axios from "axios";

// Phase A — single-user pivot.
//
// The backend no longer validates tokens; ``get_current_user`` returns a
// fixed LOCAL_USER on every request. We therefore drop:
//
//   * the request interceptor that attached ``Authorization: Bearer …``
//   * the response interceptor that redirected to /app/login on 401
//
// Login/Register routes still exist for now (Phase C deletes them along
// with the auth UI), but no normal request can produce a 401 anymore, so
// there is nothing left to intercept.

const api = axios.create({ baseURL: "/api/v1" });

export default api;
