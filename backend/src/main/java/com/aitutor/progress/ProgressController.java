package com.aitutor.progress;

import com.aitutor.entity.*;
import com.aitutor.repository.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import com.aitutor.security.AuthenticatedUser;
import java.util.*;
import com.aitutor.intelligence.LearningEventRepository;

@RestController @RequestMapping("/api/progress")
public class ProgressController {
    private final ProgressRepository pr; private final UserRepository ur; private final CourseRepository cr; private final LessonRepository lr; private final LearningEventRepository events; private final com.aitutor.intelligence.LearningEventService eventService; private final AuthenticatedUser authenticatedUser;
    public ProgressController(ProgressRepository pr,UserRepository ur,CourseRepository cr,LessonRepository lr,LearningEventRepository events, com.aitutor.intelligence.LearningEventService eventService, AuthenticatedUser authenticatedUser){this.pr=pr;this.ur=ur;this.cr=cr;this.lr=lr;this.events=events;this.eventService=eventService;this.authenticatedUser=authenticatedUser;}
    record View(Long courseId,int completedLessons,int totalLessons,double percent){}
    @GetMapping("/{userId}") List<View> all(@PathVariable Long userId, Authentication authentication){
        authenticatedUser.requireSame(authentication,userId);
        ur.findById(userId).orElseThrow(); return pr.findByUserId(userId).stream().map(p->new View(p.getCourse().getId(),p.getCompletedLessons(),p.getTotalLessons(),p.getPercent())).toList();
    }
    @PostMapping("/{userId}/course/{courseId}/lesson/{lessonId}/complete")
    @Transactional
    View complete(@PathVariable Long userId,@PathVariable Long courseId,@PathVariable Long lessonId, Authentication authentication){
        authenticatedUser.requireSame(authentication,userId);
        User u=ur.findById(userId).orElseThrow();
        Course c=cr.findById(courseId).orElseThrow();
        if (!c.isPublished() && !authenticatedUser.isAdmin(authentication)) {
            throw new NoSuchElementException("Course not found");
        }
        Lesson lesson=lr.findById(lessonId).orElseThrow();
        if (!lesson.getCourse().getId().equals(courseId)) {
            throw new IllegalArgumentException("Lesson does not belong to this course");
        }
        int total=Math.max(1, c.getTotalLessons() > 0 ? c.getTotalLessons() : (int) lr.countByCourseId(courseId));
        String dedupeKey = "LESSON_COMPLETED:" + u.getId() + ":" + c.getId() + ":" + lesson.getId();
        // Atomic first-writer-wins insert BEFORE mutating Progress prevents double-counting under concurrent requests.
        boolean newlyCompleted = eventService.recordIfAbsent(
                u, "LESSON_COMPLETED", c.getTitle(), lesson.getTitle(), 100, 0,
                "Completed lesson #" + (lesson.getOrderIndex() == null ? 1 : lesson.getOrderIndex()), dedupeKey);
        pr.ensureRowExists(userId, courseId, total);
        Progress p = pr.findByUserIdAndCourseIdForUpdate(userId, courseId).orElseThrow();
        if (newlyCompleted) {
            int nextCompleted = Math.min(total, p.getCompletedLessons() + 1);
            p.setCompletedLessons(nextCompleted);
            p.setTotalLessons(total);
            p.setPercent(nextCompleted * 100.0 / total);
            pr.save(p);
        } else if (p.getTotalLessons() != total) {
            int clamped = Math.min(total, p.getCompletedLessons());
            p.setCompletedLessons(clamped);
            p.setTotalLessons(total);
            p.setPercent(clamped * 100.0 / total);
            pr.save(p);
        }
        return new View(courseId,p.getCompletedLessons(),p.getTotalLessons(),p.getPercent());
    }
}
