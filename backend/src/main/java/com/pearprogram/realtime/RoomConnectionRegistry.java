package com.pearprogram.realtime;

import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomConnectionRegistry {
    private final ConcurrentHashMap<String, ConnectionPresence> connections = new ConcurrentHashMap<>();

    public void register(ConnectionPresence presence) {
        connections.put(presence.connectionId(), presence);
    }

    public Optional<ConnectionPresence> remove(String connectionId) {
        return Optional.ofNullable(connections.remove(connectionId));
    }

    public record ConnectionPresence(
            String roomCode,
            String userId,
            String connectionId,
            String displayName,
            String color,
            String avatarUrl
    ) {
    }
}
