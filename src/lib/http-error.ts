import type { HTTPError } from "ky";

export function getHttpErrorMessage(error: HTTPError): string | undefined {
  const body = error.data;
  return typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
    ? body.error
    : undefined;
}
