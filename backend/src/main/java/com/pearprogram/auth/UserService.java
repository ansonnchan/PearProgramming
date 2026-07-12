package com.pearprogram.auth;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@Service
public class UserService {
    private final UserRepository users;

    public UserService(UserRepository users) {
        this.users = users;
    }

    @Transactional
    public UserEntity createGuest(UUID id, String displayName, String avatarUrl) {
        return users.save(new UserEntity(id, displayName, avatarUrl));
    }

    @Transactional
    public UserEntity updateProfile(UUID id, String displayName, String avatarUrl) {
        UserEntity user = require(id);
        user.updateProfile(displayName, avatarUrl);
        return user;
    }

    @Transactional(readOnly = true)
    public UserEntity require(UUID id) {
        return users.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authenticated user no longer exists"));
    }
}
