package com.pearprogram.execution;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class Judge0ExecutionProviderTests {
    @Test
    void normalizesProviderTerminalResults() throws Exception {
        Judge0ExecutionProvider provider = provider(RestClient.builder(), properties());

        ProviderExecutionResult compiled = provider.normalize(new ObjectMapper().readTree("""
                {"status":{"id":6},"compile_output":"Main.java:1: error","time":"0.015","exit_code":1}
                """));
        ProviderExecutionResult runtime = provider.normalize(new ObjectMapper().readTree("""
                {"status":{"id":11},"stderr":"Exception","time":"0.020","exit_code":1}
                """));

        assertThat(compiled.status()).isEqualTo(ExecutionStatus.COMPILATION_ERROR);
        assertThat(compiled.compileOutput()).contains("Main.java");
        assertThat(compiled.durationMs()).isEqualTo(15);
        assertThat(runtime.status()).isEqualTo(ExecutionStatus.RUNTIME_ERROR);
    }

    @Test
    void rejectsMalformedProviderResponse() throws Exception {
        Judge0ExecutionProvider provider = provider(RestClient.builder(), properties());
        assertThatThrownBy(() -> provider.normalize(new ObjectMapper().readTree("{\"stdout\":\"orphan\"}")))
                .isInstanceOf(ExecutionProviderException.class);
    }

    @Test
    void retriesTransientErrorsOnlyWithinConfiguredBound() {
        ExecutionProperties properties = properties();
        properties.getJudge0().setMaxRetries(2);
        properties.getJudge0().setRetryBackoff(Duration.ZERO);
        RestClient.Builder builder = RestClient.builder().baseUrl("http://judge0.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(ExpectedCount.times(3), requestTo(containsString("/submissions/token")))
                .andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE).contentType(MediaType.APPLICATION_JSON));
        Judge0ExecutionProvider provider = provider(builder, properties);

        assertThatThrownBy(() -> provider.getResult("token"))
                .isInstanceOfSatisfying(ExecutionProviderException.class,
                        exception -> assertThat(exception.isTransientFailure()).isTrue());
        server.verify();
    }

    @Test
    void readsSuccessfulSubmissionAndStatusResponses() {
        ExecutionProperties properties = properties();
        RestClient.Builder builder = RestClient.builder().baseUrl("http://judge0.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(containsString("/submissions?")))
                .andRespond(withSuccess("{\"token\":\"abc\"}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(containsString("/submissions/abc?")))
                .andRespond(withSuccess("{\"status\":{\"id\":3},\"stdout\":\"ok\\n\",\"time\":\"0.001\",\"exit_code\":0}", MediaType.APPLICATION_JSON));
        Judge0ExecutionProvider provider = provider(builder, properties);

        String token = provider.submit(new ProviderExecutionRequest(71, "print('ok')", "", 5));
        ProviderExecutionResult result = provider.getResult(token);

        assertThat(token).isEqualTo("abc");
        assertThat(result.status()).isEqualTo(ExecutionStatus.COMPLETED);
        assertThat(result.stdout()).isEqualTo("ok\n");
        server.verify();
    }

    private Judge0ExecutionProvider provider(RestClient.Builder builder, ExecutionProperties properties) {
        return new Judge0ExecutionProvider(builder.build(), new ObjectMapper(), properties);
    }

    private ExecutionProperties properties() {
        ExecutionProperties properties = new ExecutionProperties();
        properties.getJudge0().setMaxRetries(0);
        properties.getJudge0().setRetryBackoff(Duration.ZERO);
        return properties;
    }
}
