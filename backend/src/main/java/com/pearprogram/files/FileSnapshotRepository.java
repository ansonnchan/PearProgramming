package com.pearprogram.files;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface FileSnapshotRepository extends JpaRepository<FileSnapshotEntity, UUID> {
}
