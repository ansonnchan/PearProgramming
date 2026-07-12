package com.pearprogram.rooms;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface RoomMemberRepository extends JpaRepository<RoomMemberEntity, UUID> {
    Optional<RoomMemberEntity> findByRoomIdAndUserId(UUID roomId, UUID userId);
    boolean existsByRoomIdAndUserId(UUID roomId, UUID userId);
}
