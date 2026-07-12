package com.pearprogram.rooms;

import jakarta.validation.constraints.NotBlank;

public record JoinRoomRequest(@NotBlank String code) {
}
