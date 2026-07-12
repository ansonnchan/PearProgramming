package com.pearprogram.auth;

public record CsrfResponse(String token, String headerName) {
}
