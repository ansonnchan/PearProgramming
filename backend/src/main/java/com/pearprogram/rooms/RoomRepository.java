package com.pearprogram.rooms;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface RoomRepository extends JpaRepository<RoomEntity, UUID> {
    Optional<RoomEntity> findByCodeAndActiveTrue(String code);
    Optional<RoomEntity> findByCode(String code);
    boolean existsByCode(String code);
}
