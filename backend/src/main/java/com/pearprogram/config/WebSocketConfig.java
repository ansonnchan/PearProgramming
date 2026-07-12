package com.pearprogram.config;

import com.pearprogram.auth.GuestPrincipal;
import com.pearprogram.rooms.EphemeralRoomStateService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    private final CorsProperties corsProperties;
    private final EphemeralRoomStateService roomStateService;
    private static final Pattern ROOM_DESTINATION = Pattern.compile("^/(?:app|topic)/room/([^/]+)(?:/.*)?$");

    public WebSocketConfig(CorsProperties corsProperties, EphemeralRoomStateService roomStateService) {
        this.corsProperties = corsProperties;
        this.roomStateService = roomStateService;
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);
                StompCommand command = accessor.getCommand();
                if (command != StompCommand.SEND && command != StompCommand.SUBSCRIBE) {
                    return message;
                }
                String destination = accessor.getDestination();
                Matcher matcher = destination == null ? null : ROOM_DESTINATION.matcher(destination);
                if (matcher == null || !matcher.matches()) {
                    throw new AccessDeniedException("Unsupported room destination");
                }
                if (!(accessor.getUser() instanceof Authentication authentication)
                        || !(authentication.getPrincipal() instanceof GuestPrincipal principal)
                        || !roomStateService.isActiveMember(matcher.group(1), principal.id())) {
                    throw new AccessDeniedException("Room membership required");
                }
                return message;
            }
        });
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns(corsProperties.getAllowedOrigins().toArray(String[]::new))
                .withSockJS();
    }

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/**")
                        .allowedOriginPatterns(corsProperties.getAllowedOrigins().toArray(String[]::new))
                        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                        .allowedHeaders("*")
                        .allowCredentials(true);
            }
        };
    }
}
