"""Request context headers and the shared error envelope."""

from uuid import uuid4

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

DOCS_PATHS = frozenset({"/docs", "/redoc", "/docs/oauth2-redirect"})
ERROR_CODES = {
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "version_conflict",
    422: "validation_error",
}


def install_http_layer(app):
    @app.middleware("http")
    async def request_context(request, call_next):
        request.state.correlation_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.correlation_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        # The interactive API docs load their own scripts, so they keep their own policy.
        if request.url.path not in DOCS_PATHS:
            response.headers.setdefault(
                "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
            )
        return response

    @app.exception_handler(HTTPException)
    async def known_error(request, exc):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": ERROR_CODES.get(exc.status_code, "request_failed"),
                    "message": str(exc.detail),
                    "retryable": False,
                    "correlation_id": request.state.correlation_id,
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        # Do not echo request input (could contain sensitive content).
        return await known_error(
            request,
            HTTPException(422, "Check the fields, lengths and timezone-aware dates"),
        )

    @app.exception_handler(StaleDataError)
    async def stale(request, exc):
        return await known_error(
            request,
            HTTPException(
                409, "This task changed in another session. Refresh and try again."
            ),
        )

    @app.exception_handler(IntegrityError)
    async def duplicate(request, exc):
        return await known_error(
            request,
            HTTPException(
                409,
                "A concurrent request has already committed. Retry with the same request key.",
            ),
        )
