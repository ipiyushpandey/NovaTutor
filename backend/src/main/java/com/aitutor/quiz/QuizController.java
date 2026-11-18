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

    private static final int DAILY_QUIZ_XP_CAP = 10;

    @PostMapping("/course/{courseId}/submit")
    @org.springframework.transaction.annotation.Transactional
    Result submit(@PathVariable Long courseId,@RequestBody Submit s, Authentication authentication){
        Course course=courses.findById(courseId).orElseThrow();
        User user=authenticatedUser.require(authentication);
        if (!course.isPublished() && !authenticatedUser.isAdmin(user)) {
            throw new NoSuchElementException("Course not found");
        }
        if (s == null || s.answers() == null || s.answers().isEmpty()) {
            throw new IllegalArgumentException("At least one quiz answer is required");
        }
        Map<Long,QuizQuestion> available = repo.findByCourseIdOrderByIdAsc(courseId).stream()
                .collect(Collectors.toMap(QuizQuestion::getId, Function.identity(), (a,b)->a));
        Map<Long,Integer> selected=new LinkedHashMap<>();
        for (Answer a : s.answers()) {
            if (a == null || a.questionId() == null) {
                throw new IllegalArgumentException("Each quiz answer must include a valid questionId");
            }
            if (a.selectedOption() < 0 || a.selectedOption() > 3) {
                throw new IllegalArgumentException("Quiz answer option must be between 0 and 3");
            }
            selected.put(a.questionId(), a.selectedOption());
        }
        // Grade only the distinct valid questions for this course, capped at the quiz size.
        List<Long> questionIds = selected.keySet().stream().filter(available::containsKey).limit(QUIZ_SIZE).toList();
        if (questionIds.isEmpty()) {
            throw new IllegalArgumentException("No valid quiz questions were submitted for this course");
        }
        User lockedUser = users.findByIdForUpdate(user.getId()).orElseThrow();
        java.time.LocalDate todayIst = com.aitutor.intelligence.LearningEventAnalyticsService.todayIst();
        java.time.LocalDateTime startOfToday = com.aitutor.intelligence.LearningEventAnalyticsService.startOfTodayIst();
        int correct=0; List<Long> wrong=new ArrayList<>();
        for(Long id:questionIds){
            QuizQuestion q=available.get(id);
            boolean ok=selected.get(id)==q.getCorrectOption();
            if(ok) correct++; else wrong.add(id);
            String topic=q.getTopic();
            if(topic==null||topic.isBlank()){ topic=conceptFromQuestion(q.getQuestion(),course.getTitle()); }
            // Deduplicate per (user, question, outcome, IST day) so retrying a wrong question and
            // getting it right still updates revision tracking while blocking per-minute XP replay.
            eventService.recordIfAbsent(lockedUser,"QUIZ_QUESTION",course.getTitle(),topic,ok?100:0,0,
                    "questionId="+id+";difficulty="+Objects.toString(q.getDifficulty(),"Mixed"),
                    "QUIZ_QUESTION:"+lockedUser.getId()+":"+id+":"+(ok?"1":"0")+":"+todayIst);
        }
        int total=questionIds.size();
        int score=(int)Math.round(correct*100.0/total);
        String msg=score>=80?"Excellent! You're ready for the next challenge.":score>=60?"Good work. Review the missed questions once.":"Let's revise the weak concepts and try again.";
        QuizAttempt attempt = attempts.save(new QuizAttempt(lockedUser,course,total,correct,score,wrong.stream().map(String::valueOf).collect(Collectors.joining(","))));
        long todayCompletedQuizzes = events.countByUserIdAndTypeInAndCreatedAtGreaterThanEqual(
                lockedUser.getId(), List.of("QUIZ_COMPLETED"), startOfToday);
        if (todayCompletedQuizzes < DAILY_QUIZ_XP_CAP) {
            eventService.recordIfAbsent(lockedUser,"QUIZ_COMPLETED",course.getTitle(),"Quiz mastery",score,0,
                    "Correct "+correct+" of "+total,"QUIZ_COMPLETED:"+lockedUser.getId()+":"+attempt.getId());
        }
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
