package com.pearprogram.config;

import com.pearprogram.rooms.RoomRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MetricsConfig {
    public MetricsConfig(MeterRegistry meterRegistry, RoomRepository roomRepository) {
        Gauge.builder("active_rooms", roomRepository, RoomRepository::countActiveRooms)
                .description("Total currently active rooms")
                .register(meterRegistry);
    }
}
