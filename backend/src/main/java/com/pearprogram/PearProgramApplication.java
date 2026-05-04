package com.pearprogram;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication
public class PearProgramApplication {
    public static void main(String[] args) {
        SpringApplication.run(PearProgramApplication.class, args);
    }
}
