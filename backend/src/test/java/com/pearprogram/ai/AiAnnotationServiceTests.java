package com.pearprogram.ai;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AiAnnotationServiceTests {
    private final AiAnnotationService service = new AiAnnotationService();

    @Test
    void reportsUnavailablePersistenceInsteadOfReturningFakeResults() {
        CreateAnnotationRequest request = new CreateAnnotationRequest(UUID.randomUUID(), 3, "Suggestion");

        assertThatThrownBy(() -> service.create("ABC123", request))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> org.assertj.core.api.Assertions.assertThat(exception.getStatusCode())
                                .isEqualTo(HttpStatus.NOT_IMPLEMENTED));
        assertThatThrownBy(() -> service.dismiss(UUID.randomUUID()))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> org.assertj.core.api.Assertions.assertThat(exception.getStatusCode())
                                .isEqualTo(HttpStatus.NOT_IMPLEMENTED));
    }
}
