import axios from "axios";

// Single-user app: the backend doesn't validate tokens, so there are no auth
// interceptors — no Authorization header to attach and no 401 redirect to
// handle.

const api = axios.create({ baseURL: "/api/v1" });

export default api;
