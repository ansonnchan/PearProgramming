CREATE TABLE ai_annotations (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES workspace_files(id) ON DELETE CASCADE,
    triggered_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
    line_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    dismissed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT chk_ai_annotation_line CHECK (line_number > 0)
);

CREATE INDEX idx_ai_annotations_active_file ON ai_annotations(room_id, file_id, dismissed, created_at);
