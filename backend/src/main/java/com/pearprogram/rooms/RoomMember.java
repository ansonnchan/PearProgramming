package com.pearprogram.rooms;

import com.pearprogram.users.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.MapsId;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;

@Entity
@Table(name = "room_members")
public class RoomMember {
    @EmbeddedId
    private RoomMemberId id = new RoomMemberId();

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("roomId")
    @JoinColumn(name = "room_id", nullable = false)
    private Room room;

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("userId")
    @JoinColumn(name = "user_id", nullable = false)
    private AppUser user;

    @Column(name = "cursor_color", nullable = false)
    private String cursorColor;

    @Column(name = "cursor_line", nullable = false)
    private int cursorLine = 1;

    @Column(name = "cursor_col", nullable = false)
    private int cursorCol = 1;

    @Column(name = "joined_at", nullable = false)
    private OffsetDateTime joinedAt = OffsetDateTime.now();

    public RoomMemberId getId() {
        return id;
    }

    public void setId(RoomMemberId id) {
        this.id = id;
    }

    public Room getRoom() {
        return room;
    }

    public void setRoom(Room room) {
        this.room = room;
    }

    public AppUser getUser() {
        return user;
    }

    public void setUser(AppUser user) {
        this.user = user;
    }

    public String getCursorColor() {
        return cursorColor;
    }

    public void setCursorColor(String cursorColor) {
        this.cursorColor = cursorColor;
    }

    public int getCursorLine() {
        return cursorLine;
    }

    public void setCursorLine(int cursorLine) {
        this.cursorLine = cursorLine;
    }

    public int getCursorCol() {
        return cursorCol;
    }

    public void setCursorCol(int cursorCol) {
        this.cursorCol = cursorCol;
    }

    public OffsetDateTime getJoinedAt() {
        return joinedAt;
    }

    public void setJoinedAt(OffsetDateTime joinedAt) {
        this.joinedAt = joinedAt;
    }
}
