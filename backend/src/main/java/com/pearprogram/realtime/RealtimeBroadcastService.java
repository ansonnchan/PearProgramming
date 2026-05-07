package com.pearprogram.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class RealtimeBroadcastService implements MessageListener {
    private static final Logger log = LoggerFactory.getLogger(RealtimeBroadcastService.class);

    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final String instanceId = UUID.randomUUID().toString();
    private final String channelName;
    private final boolean redisBroadcastEnabled;
    private final AtomicBoolean publishFailureLogged = new AtomicBoolean(false);

    public RealtimeBroadcastService(
            SimpMessagingTemplate messagingTemplate,
            StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper,
            @Value("${pearprogram.redis.key-prefix:pearprogram}") String keyPrefix,
            @Value("${pearprogram.realtime.redis-broadcast-enabled:true}") boolean redisBroadcastEnabled
    ) {
        this.messagingTemplate = messagingTemplate;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.channelName = normalizeKeyPrefix(keyPrefix) + ":stomp-broadcast";
        this.redisBroadcastEnabled = redisBroadcastEnabled;
    }

    @PostConstruct
    void logMode() {
        log.info("Room STOMP broadcast bridge configured: redisBroadcastEnabled={}, channel={}, instanceId={}",
                redisBroadcastEnabled, channelName, shortInstanceId());
    }

    public String channelName() {
        return channelName;
    }

    public void broadcast(String topic, Object payload) {
        String payloadJson = toJson(payload);
        sendJson(topic, payloadJson);
        if (!redisBroadcastEnabled) {
            return;
        }

        try {
            redisTemplate.convertAndSend(channelName, objectMapper.writeValueAsString(new Envelope(instanceId, topic, payloadJson)));
        } catch (RuntimeException | JsonProcessingException ex) {
            if (publishFailureLogged.compareAndSet(false, true)) {
                log.warn("Redis STOMP broadcast failed; cross-instance room subscribers may miss events. reason={}",
                        rootCauseMessage(ex));
            }
        }
    }

    public void sendLocal(String topic, Object payload) {
        sendJson(topic, toJson(payload));
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            String raw = new String(message.getBody(), StandardCharsets.UTF_8);
            Envelope envelope = objectMapper.readValue(raw, Envelope.class);
            if (instanceId.equals(envelope.originInstanceId())) {
                return;
            }
            if (!isRoomTopic(envelope.topic())) {
                log.warn("Ignoring Redis STOMP broadcast for unexpected topic {}", envelope.topic());
                return;
            }
            sendJson(envelope.topic(), envelope.payloadJson());
        } catch (RuntimeException | JsonProcessingException ex) {
            log.warn("Failed to process Redis STOMP broadcast. reason={}", rootCauseMessage(ex));
        }
    }

    private void sendJson(String topic, String payloadJson) {
        if (!isRoomTopic(topic)) {
            throw new IllegalArgumentException("Only /topic/room broadcasts are supported");
        }
        messagingTemplate.convertAndSend(topic, payloadJson);
    }

    private String toJson(Object payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException ex) {
            throw new IllegalArgumentException("Unable to serialize realtime payload", ex);
        }
    }

    private boolean isRoomTopic(String topic) {
        return topic != null && topic.startsWith("/topic/room/");
    }

    private String normalizeKeyPrefix(String raw) {
        String normalized = raw == null ? "" : raw.trim().replaceAll("^:+|:+$", "");
        return normalized.isBlank() ? "pearprogram" : normalized;
    }

    private String shortInstanceId() {
        return instanceId.substring(0, 8);
    }

    private String rootCauseMessage(Throwable ex) {
        Throwable current = ex;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current.getMessage() == null || current.getMessage().isBlank()
                ? current.getClass().getSimpleName()
                : current.getMessage();
    }

    private record Envelope(String originInstanceId, String topic, String payloadJson) {
    }
}
