package com.pearprogram.rooms;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;

@Component
public class RoomCodeGenerator {
    private static final char[] DEFAULT_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();
    private static final char[] EXPANDED_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijklmnopqrstuvwxyz".toCharArray();

    private final SecureRandom random = new SecureRandom();

    public String generateDefault() {
        return generate(DEFAULT_CHARS);
    }

    public String generateExpanded() {
        return generate(EXPANDED_CHARS).toUpperCase();
    }

    private String generate(char[] alphabet) {
        return new StringBuilder(6)
                .append(randomChar(alphabet))
                .append(randomChar(alphabet))
                .append(randomChar(alphabet))
                .append(randomChar(alphabet))
                .append(randomChar(alphabet))
                .append(randomChar(alphabet))
                .toString();
    }

    private char randomChar(char[] alphabet) {
        return alphabet[random.nextInt(alphabet.length)];
    }
}
