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
        Lesson lesson=lr.findById(lessonId).orElseThrow();
        if (!lesson.getCourse().getId().equals(courseId)) {
            throw new IllegalArgumentException("Lesson does not belong to this course");
        }
        int total=Math.max(1, c.getTotalLessons() > 0 ? c.getTotalLessons() : (int) lr.countByCourseId(courseId));
        Progress p=pr.findByUserIdAndCourseId(userId,courseId).orElseGet(()->{Progress x=new Progress();x.setUser(u);x.setCourse(c);x.setTotalLessons(total);return x;});
        String dedupeKey = "LESSON_COMPLETED:" + u.getId() + ":" + c.getId() + ":" + lesson.getId();
        boolean alreadyCompleted = events.findByUserIdAndDedupeKey(u.getId(), dedupeKey).isPresent();
        if (!alreadyCompleted) {
            int nextCompleted = Math.min(total, p.getCompletedLessons() + 1);
            p.setCompletedLessons(nextCompleted);
            p.setTotalLessons(total);
            p.setPercent(nextCompleted * 100.0 / total);
            pr.save(p);
            eventService.record(u, "LESSON_COMPLETED", c.getTitle(), lesson.getTitle(), 100, 0,
                    "Completed lesson #" + nextCompleted, dedupeKey);
        } else if (p.getTotalLessons() != total) {
            p.setTotalLessons(total);
            p.setPercent(Math.min(total, p.getCompletedLessons()) * 100.0 / total);
            pr.save(p);
        }
        return new View(courseId,p.getCompletedLessons(),p.getTotalLessons(),p.getPercent());
    }
}
