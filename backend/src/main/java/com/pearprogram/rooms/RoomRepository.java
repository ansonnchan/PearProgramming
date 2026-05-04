package com.pearprogram.rooms;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;
import java.util.UUID;

public interface RoomRepository extends JpaRepository<Room, UUID> {
    Optional<Room> findByCode(String code);

    boolean existsByCode(String code);

    @Query("select count(r) from Room r where r.active = true and r.expiresAt > current_timestamp")
    long countActiveRooms();
}
