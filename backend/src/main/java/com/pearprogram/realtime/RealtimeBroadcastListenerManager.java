package com.pearprogram.realtime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class RealtimeBroadcastListenerManager {
    private static final Logger log = LoggerFactory.getLogger(RealtimeBroadcastListenerManager.class);

    private final ObjectProvider<RedisMessageListenerContainer> listenerContainerProvider;
    private final StringRedisTemplate redisTemplate;
    private final RealtimeBroadcastService broadcastService;
    private final AtomicBoolean failureLogged = new AtomicBoolean(false);

    public RealtimeBroadcastListenerManager(
            ObjectProvider<RedisMessageListenerContainer> listenerContainerProvider,
            StringRedisTemplate redisTemplate,
            RealtimeBroadcastService broadcastService
    ) {
        this.listenerContainerProvider = listenerContainerProvider;
        this.redisTemplate = redisTemplate;
        this.broadcastService = broadcastService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void startAfterApplicationReady() {
        tryStart();
    }

    @Scheduled(fixedDelayString = "${pearprogram.realtime.redis-broadcast-retry-ms:30000}")
    public void retryStart() {
        tryStart();
    }

    private void tryStart() {
        RedisMessageListenerContainer container = listenerContainerProvider.getIfAvailable();
        if (container == null || container.isRunning()) {
            return;
        }

        try {
            redisTemplate.execute((RedisConnection connection) -> {
                connection.ping();
                return null;
            });
            container.start();
            failureLogged.set(false);
            log.info("Room STOMP Redis broadcast listener started: channel={}", broadcastService.channelName());
        } catch (RuntimeException ex) {
            if (failureLogged.compareAndSet(false, true)) {
                log.warn("Room STOMP Redis broadcast listener is not connected; same-room WebSocket events only reach this backend instance until Redis pub/sub connects. reason={}",
                        rootCauseMessage(ex));
            }
        }
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
}
