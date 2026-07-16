package com.pearprogram.realtime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Component
public class RoomDisconnectListener {
    private static final Logger log = LoggerFactory.getLogger(RoomDisconnectListener.class);
    private final RoomPresenceEventService presence;

    public RoomDisconnectListener(RoomPresenceEventService presence) {
        this.presence = presence;
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        log.info("STOMP connection disconnected connectionId={}", event.getSessionId());
        presence.disconnect(event.getSessionId());
    }
}
