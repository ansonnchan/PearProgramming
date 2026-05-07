package com.pearprogram.config;

import io.lettuce.core.RedisURI;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.RedisPassword;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

import java.time.Duration;

@Configuration
public class RedisConfig {
    private static final Logger log = LoggerFactory.getLogger(RedisConfig.class);

    @Bean
    public RedisConnectionFactory redisConnectionFactory(
            @Value("${SPRING_REDIS_URL:${REDIS_URL:}}") String redisUrl,
            @Value("${spring.data.redis.host:localhost}") String redisHost,
            @Value("${spring.data.redis.port:6379}") int redisPort,
            @Value("${spring.data.redis.password:}") String redisPassword,
            @Value("${spring.data.redis.ssl.enabled:false}") boolean redisSslEnabled,
            @Value("${spring.data.redis.timeout:2000ms}") Duration redisTimeout
    ) {
        LettuceClientConfiguration.LettuceClientConfigurationBuilder clientBuilder =
                LettuceClientConfiguration.builder().commandTimeout(redisTimeout);
        RedisStandaloneConfiguration redisConfiguration = standaloneConfiguration(redisHost, redisPort, redisPassword);

        if (redisUrl != null && !redisUrl.isBlank()) {
            try {
                RedisURI uri = RedisURI.create(redisUrl);
                redisConfiguration = standaloneConfiguration(
                        uri.getHost(),
                        uri.getPort() > 0 ? uri.getPort() : 6379,
                        uri.getPassword() == null ? "" : new String(uri.getPassword())
                );
                if (uri.getUsername() != null && !uri.getUsername().isBlank()) {
                    redisConfiguration.setUsername(uri.getUsername());
                }
                if (uri.isSsl()) {
                    clientBuilder.useSsl();
                }
            } catch (RuntimeException ex) {
                log.warn("Invalid Redis TCP URL; falling back to host/port Redis settings. reason={}", ex.getClass().getSimpleName());
            }
        } else if (redisSslEnabled) {
            clientBuilder.useSsl();
        }

        return new LettuceConnectionFactory(redisConfiguration, clientBuilder.build());
    }

    private RedisStandaloneConfiguration standaloneConfiguration(String host, int port, String password) {
        RedisStandaloneConfiguration configuration = new RedisStandaloneConfiguration(host, port);
        if (password != null && !password.isBlank()) {
            configuration.setPassword(RedisPassword.of(password));
        }
        return configuration;
    }
}
