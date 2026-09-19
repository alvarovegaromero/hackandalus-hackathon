// OWNER: demo event intake authorization.
import "server-only";
import { authorize } from "./api-auth";

/** Local demo is open without a token; production requires authenticated intake. */
export function authorizePipeline(request: Request) {
  if (process.env.NODE_ENV === "development" && !process.env.CRISIS_API_TOKEN) return;
  return authorize(request);
}
