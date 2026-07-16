package com.pearprogram.execution;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/execution/languages")
public class ExecutionLanguageController {
    private final ExecutionLanguageRegistry languages;

    public ExecutionLanguageController(ExecutionLanguageRegistry languages) {
        this.languages = languages;
    }

    @GetMapping
    public List<ExecutionLanguageOption> list() {
        return languages.options();
    }
}
