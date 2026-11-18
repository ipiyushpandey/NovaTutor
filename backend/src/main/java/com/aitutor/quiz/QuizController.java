package com.aitutor.quiz;

import com.aitutor.entity.Course;
import com.aitutor.entity.User;
import com.aitutor.repository.UserRepository;
import com.aitutor.intelligence.QuizAttempt;
import com.aitutor.intelligence.QuizAttemptRepository;
import com.aitutor.intelligence.LearningEvent;
import com.aitutor.intelligence.LearningEventRepository;
import com.aitutor.repository.CourseRepository;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import com.aitutor.security.AuthenticatedUser;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@RestController @RequestMapping("/api/quizzes")
public class QuizController {
    private static final int QUIZ_SIZE = 20;
    private final QuizQuestionRepository repo; private final CourseRepository courses; private final UserRepository users; private final QuizAttemptRepository attempts; private final LearningEventRepository events; private final com.aitutor.intelligence.LearningEventService eventService; private final AuthenticatedUser authenticatedUser;
    public QuizController(QuizQuestionRepository repo, CourseRepository courses, UserRepository users, QuizAttemptRepository attempts, LearningEventRepository events, com.aitutor.intelligence.LearningEventService eventService, AuthenticatedUser authenticatedUser){this.repo=repo;this.courses=courses;this.users=users;this.attempts=attempts;this.events=events;this.eventService=eventService;this.authenticatedUser=authenticatedUser;}
    record Question(Long id,String question,List<String> options,String difficulty){}
    record Answer(Long questionId,int selectedOption){}
    record Submit(Long userId,List<Answer> answers){}
    record Result(int total,int correct,int score,String message,List<Long> wrongQuestionIds){}

    @GetMapping("/course/{courseId}")
    List<Question> questions(@PathVariable Long courseId, Authentication authentication){
        Course course = courses.findById(courseId).orElseThrow();
        if (!course.isPublished() && !authenticatedUser.isAdmin(authentication)) {
            throw new NoSuchElementException("Course not found");
        }
        // Remove duplicate question text, shuffle the pool, then expose exactly 20 questions.
        // This repairs old databases that may already contain repeated quiz rows.
        Map<String, QuizQuestion> unique = new LinkedHashMap<>();
        for (QuizQuestion q : repo.findByCourseIdOrderByIdAsc(courseId)) {
            String key = q.getQuestion() == null ? "" : q.getQuestion().trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
            if (!key.isBlank()) unique.putIfAbsent(key, q);
        }
        List<QuizQuestion> selected = new ArrayList<>(unique.values());
        Collections.shuffle(selected);
        if (selected.size() > QUIZ_SIZE) selected = new ArrayList<>(selected.subList(0, QUIZ_SIZE));
        return selected.stream().map(q -> new Question(q.getId(),q.getQuestion(),List.of(q.getOptionA(),q.getOptionB(),q.getOptionC(),q.getOptionD()),q.getDifficulty())).toList();
    }

    /**
     * Wrong-answer revision. Only questions the student actually answered
     * incorrectly are eligible; anything answered correctly (in any attempt)
     * is excluded, and unanswered questions are never guessed as wrong.
     * Canonical text dedupe protects against duplicate rows in old databases.
     */
    @GetMapping("/course/{courseId}/revision")
    List<Question> revision(@PathVariable Long courseId, Authentication authentication) {
        Course course = courses.findById(courseId).orElseThrow();
        User user = authenticatedUser.require(authentication);
        if (!course.isPublished() && !authenticatedUser.isAdmin(user)) {
            throw new NoSuchElementException("Course not found");
        }
        Set<Long> wrong = new LinkedHashSet<>();
        Set<Long> correct = new HashSet<>();
        for (QuizAttempt attempt : attempts.findByUserId(user.getId())) {
            if (attempt.getCourse() == null || !courseId.equals(attempt.getCourse().getId())) continue;
            for (String raw : Objects.toString(attempt.getWrongQuestionIds(), "").split(",")) {
                try { if (!raw.isBlank()) wrong.add(Long.valueOf(raw.trim())); } catch (NumberFormatException ignored) { }
            }
        }
        // Correct answers are tracked from the per-question learning events, which
        // include every graded question (including attempts whose wrong list is old).
        events.findByUserIdOrderByCreatedAtAsc(user.getId()).stream()
                .filter(e -> "QUIZ_QUESTION".equals(e.getType()) && e.getScore() != null && e.getScore() >= 100)
                .forEach(e -> {
                    String details = Objects.toString(e.getDetails(), "");
                    int at = details.indexOf("questionId=");
                    if (at < 0) return;
                    String digits = details.substring(at + 11).split("[^0-9]", 2)[0];
                    try { if (!digits.isBlank()) correct.add(Long.valueOf(digits)); } catch (NumberFormatException ignored) { }
                });
        Map<Long, QuizQuestion> available = repo.findByCourseIdOrderByIdAsc(courseId).stream()
                .collect(Collectors.toMap(QuizQuestion::getId, Function.identity(), (a, b) -> a));
        Map<String, QuizQuestion> unique = new LinkedHashMap<>();
        for (Long id : wrong) {
            if (correct.contains(id)) continue;
            QuizQuestion q = available.get(id);
            if (q == null) continue;
            String key = canonical(q.getQuestion());
            if (!key.isBlank()) unique.putIfAbsent(key, q);
        }
        List<QuizQuestion> selected = new ArrayList<>(unique.values());
        Collections.shuffle(selected);
        if (selected.size() > QUIZ_SIZE) selected = new ArrayList<>(selected.subList(0, QUIZ_SIZE));
        return selected.stream().map(q -> new Question(q.getId(), q.getQuestion(),
                List.of(q.getOptionA(), q.getOptionB(), q.getOptionC(), q.getOptionD()), q.getDifficulty())).toList();
    }

    private static String canonical(String text) {
        return text == null ? "" : text.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    @PostMapping("/course/{courseId}/submit")
    Result submit(@PathVariable Long courseId,@RequestBody Submit s, Authentication authentication){
        Course course=courses.findById(courseId).orElseThrow();
        User user=authenticatedUser.require(authentication);
        if (!course.isPublished() && !authenticatedUser.isAdmin(user)) {
            throw new NoSuchElementException("Course not found");
        }
        Map<Long,QuizQuestion> available = repo.findByCourseIdOrderByIdAsc(courseId).stream()
                .collect(Collectors.toMap(QuizQuestion::getId, Function.identity(), (a,b)->a));
        Map<Long,Integer> selected=new HashMap<>();
        if(s!=null && s.answers()!=null) s.answers().forEach(a->{ if(a!=null && a.questionId()!=null) selected.put(a.questionId(),a.selectedOption()); });
        int correct=0; List<Long> wrong=new ArrayList<>();
        // Grade only the distinct questions submitted by the client, capped at the quiz size.
        List<Long> questionIds = selected.keySet().stream().filter(available::containsKey).limit(QUIZ_SIZE).toList();
        for(Long id:questionIds){
            QuizQuestion q=available.get(id);
            boolean ok=selected.get(id)==q.getCorrectOption();
            if(ok) correct++; else wrong.add(id);
            String topic=q.getTopic();
            if(topic==null||topic.isBlank()){ topic=conceptFromQuestion(q.getQuestion(),course.getTitle()); }
            eventService.record(user,"QUIZ_QUESTION",course.getTitle(),topic,ok?100:0,0,"questionId="+id+";difficulty="+Objects.toString(q.getDifficulty(),"Mixed"),// Include the outcome so a correct retry in the same minute is not swallowed by
            // the wrong attempt's dedupe key. Question revision depends on this signal.
            "QUIZ_QUESTION:"+user.getId()+":"+id+":"+(ok?"1":"0")+":"+System.currentTimeMillis()/60000);
        }
        int total=questionIds.size();
        int score=total==0?0:(int)Math.round(correct*100.0/total);
        String msg=score>=80?"Excellent! You're ready for the next challenge.":score>=60?"Good work. Review the missed questions once.":"Let's revise the weak concepts and try again.";
        QuizAttempt attempt = attempts.save(new QuizAttempt(user,course,total,correct,score,wrong.stream().map(String::valueOf).collect(Collectors.joining(","))));
        eventService.record(user,"QUIZ_COMPLETED",course.getTitle(),"Quiz mastery",score,0,"Correct "+correct+" of "+total,"QUIZ_COMPLETED:"+user.getId()+":"+attempt.getId());
        return new Result(total,correct,score,msg,wrong);
    }
    private static String conceptFromQuestion(String question,String course){
        String q=Objects.toString(question,"").toLowerCase(Locale.ROOT);
        String[][] map={{"spring","Spring Boot"},{"rest","REST APIs"},{"security","Security"},{"jwt","JWT"},{"sql","SQL"},{"database","Database Design"},{"normaliz","Normalization"},{"index","Indexing"},{"process","Processes"},{"thread","Threads"},{"memory","Memory Management"},{"deadlock","Deadlocks"},{"tcp","TCP"},{"http","HTTP"},{"dns","DNS"},{"routing","Routing"},{"array","Arrays"},{"linked","Linked Lists"},{"tree","Trees"},{"graph","Graphs"},{"queue","Queues"},{"stack","Stacks"},{"binary search","Binary Search"},{"hash","Hashing"},{"recursion","Recursion"},{"dynamic","Dynamic Programming"},{"html","HTML Semantics"},{"css","CSS"},{"react","React"},{"javascript","JavaScript"},{"compiler","Compiler Design"},{"parsing","Parsing"},{"algorithm","Algorithms"},{"complexity","Complexity"},{"git","Git"},{"docker","Containers"},{"cloud","Cloud"}};
        for(String[] pair:map) if(q.contains(pair[0])) return pair[1];
        if(Objects.toString(course,"").contains("DSA")) return "Core DSA";
        if(Objects.toString(course,"").contains("Java")) return "Core Java";
        return "Core Concepts";
    }

}
