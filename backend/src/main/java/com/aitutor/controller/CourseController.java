package com.aitutor.controller;

import com.aitutor.entity.*;
import com.aitutor.repository.*;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

@RestController
@RequestMapping("/api/courses")
public class CourseController {
    private final CourseRepository cr;
    private final LessonRepository lr;

    public CourseController(CourseRepository c, LessonRepository l) {
        this.cr = c;
        this.lr = l;
    }

    @GetMapping
    public List<Course> all() {
        return cr.findByPublishedTrue();
    }

    @GetMapping("/{id}")
    public Map<String, Object> one(@PathVariable Long id, Authentication authentication) {
        Course c = cr.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Course not found"));
        boolean isAdmin = authentication != null && authentication.getAuthorities().stream()
                .anyMatch(a -> "ROLE_ADMIN".equalsIgnoreCase(a.getAuthority()));
        if (!c.isPublished() && !isAdmin) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Course not found");
        }
        return Map.of("course", c, "lessons", lr.findByCourseIdOrderByOrderIndex(id));
    }
}
