package com.pearprogram.execution;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class Judge0ClientConfig {
    @Bean
    @Qualifier("judge0RestClient")
    RestClient judge0RestClient(ExecutionProperties properties) {
        ExecutionProperties.Judge0 settings = properties.getJudge0();
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(settings.getRequestTimeout());
        requestFactory.setReadTimeout(settings.getRequestTimeout());

        RestClient.Builder builder = RestClient.builder()
                .baseUrl(trimTrailingSlash(settings.getBaseUrl()))
                .requestFactory(requestFactory)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE);
        if (settings.getApiKey() != null && !settings.getApiKey().isBlank()) {
            builder.defaultHeader("X-RapidAPI-Key", settings.getApiKey().trim());
        }
        if (settings.getApiHost() != null && !settings.getApiHost().isBlank()) {
            builder.defaultHeader("X-RapidAPI-Host", settings.getApiHost().trim());
        }
        return builder.build();
    }

    private String trimTrailingSlash(String value) {
        String normalized = value == null ? "" : value.trim().replaceAll("/+$", "");
        return normalized.isBlank() ? "http://localhost:2358" : normalized;
    }
}
