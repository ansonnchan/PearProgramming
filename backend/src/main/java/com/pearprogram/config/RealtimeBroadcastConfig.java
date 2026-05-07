package com.pearprogram.config;

import com.pearprogram.realtime.RealtimeBroadcastService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

@Configuration
public class RealtimeBroadcastConfig {
    @Bean
    @ConditionalOnProperty(prefix = "pearprogram.realtime", name = "redis-broadcast-enabled", havingValue = "true", matchIfMissing = true)
    public RedisMessageListenerContainer redisRoomBroadcastListenerContainer(
            RedisConnectionFactory connectionFactory,
            RealtimeBroadcastService broadcastService
    ) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer() {
            @Override
            public boolean isAutoStartup() {
                return false;
            }
        };
        container.setConnectionFactory(connectionFactory);
        container.setRecoveryInterval(5000L);
        container.addMessageListener(broadcastService, new ChannelTopic(broadcastService.channelName()));
        return container;
    }
}
