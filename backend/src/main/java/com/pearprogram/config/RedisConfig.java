package com.pearprogram.config;

import io.lettuce.core.RedisURI;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisPassword;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

import java.time.Duration;

@Configuration
public class RedisConfig {
    private static final Logger log = LoggerFactory.getLogger(RedisConfig.class);

    @Bean
    public LettuceConnectionFactory redisConnectionFactory(
            @Value("${SPRING_REDIS_URL:${REDIS_URL:}}") String redisUrl,
            @Value("${spring.data.redis.host:localhost}") String redisHost,
            @Value("${spring.data.redis.port:6379}") int redisPort,
            @Value("${SPRING_REDIS_USERNAME:}") String redisUsername,
            @Value("${spring.data.redis.password:}") String redisPassword,
            @Value("${spring.data.redis.ssl.enabled:false}") boolean redisSslEnabled,
            @Value("${spring.data.redis.timeout:2000ms}") Duration redisTimeout
    ) {
        LettuceClientConfiguration.LettuceClientConfigurationBuilder clientBuilder =
                LettuceClientConfiguration.builder().commandTimeout(redisTimeout);
        String configuredUrl = redisUrl == null ? "" : redisUrl.trim();
        String configuredHost = redisHost == null ? "localhost" : redisHost.trim();
        String configuredUsername = redisUsername == null ? "" : redisUsername.trim();
        String configuredPassword = redisPassword == null ? "" : redisPassword.trim();
        boolean sslEnabled = redisSslEnabled;
        String source = "split-env";
        RedisStandaloneConfiguration redisConfiguration = standaloneConfiguration(configuredHost, redisPort, configuredUsername, configuredPassword);

        if (!configuredUrl.isBlank()) {
            try {
                RedisURI uri = RedisURI.create(configuredUrl);
                source = "url";
                sslEnabled = uri.isSsl();
                configuredHost = uri.getHost();
                configuredUsername = uri.getUsername() == null ? "" : uri.getUsername();
                redisConfiguration = standaloneConfiguration(
                        configuredHost,
                        uri.getPort() > 0 ? uri.getPort() : 6379,
                        configuredUsername,
                        uri.getPassword() == null ? "" : new String(uri.getPassword())
                );
                if (sslEnabled) {
                    clientBuilder.useSsl();
                }
            } catch (RuntimeException ex) {
                log.warn("Invalid Redis TCP URL; falling back to host/port Redis settings. reason={}", ex.getClass().getSimpleName());
                if (redisSslEnabled) {
                    sslEnabled = true;
                    clientBuilder.useSsl();
                }
            }
        } else if (redisSslEnabled) {
            clientBuilder.useSsl();
        }

        log.info("Redis connection factory configured: source={}, host={}, port={}, usernamePresent={}, sslEnabled={}, timeoutMs={}",
                source,
                configuredHost == null || configuredHost.isBlank() ? "<missing>" : configuredHost,
                redisConfiguration.getPort(),
                configuredUsername != null && !configuredUsername.isBlank(),
                sslEnabled,
                redisTimeout.toMillis());
        LettuceConnectionFactory factory = new LettuceConnectionFactory(redisConfiguration, clientBuilder.build());
        factory.setAutoStartup(true);
        return factory;
    }

    private RedisStandaloneConfiguration standaloneConfiguration(String host, int port, String username, String password) {
        RedisStandaloneConfiguration configuration = new RedisStandaloneConfiguration(host, port);
        if (username != null && !username.isBlank()) {
            configuration.setUsername(username);
        }
        if (password != null && !password.isBlank()) {
            configuration.setPassword(RedisPassword.of(password));
        }
        return configuration;
    }
}
