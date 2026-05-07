package com.pearprogram.rooms;

import java.util.List;
import java.util.Map;

public record RoomFilesRequest(List<Map<String, Object>> files) {
}
