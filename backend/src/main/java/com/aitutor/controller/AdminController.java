package com.aitutor.controller;

import com.aitutor.chat.ChatConversation;
import com.aitutor.chat.ChatMessage;
import com.aitutor.chat.ConversationRepository;
import com.aitutor.chat.MessageRepository;
import com.aitutor.config.AuditLog;
import com.aitutor.config.AuditLogRepository;
import com.aitutor.config.Announcement;
import com.aitutor.config.AnnouncementRepository;
import com.aitutor.config.AppMeta;
import com.aitutor.config.AppMetaRepository;
import com.aitutor.intelligence.QuizAttemptRepository;
import com.aitutor.entity.Course;
import com.aitutor.entity.Lesson;
import com.aitutor.entity.Progress;
import com.aitutor.entity.User;
import com.aitutor.entity.CommunityPost;
import com.aitutor.repository.CommunityPostRepository;
import com.aitutor.quiz.QuizQuestionRepository;
import com.aitutor.quiz.QuizQuestion;
import com.aitutor.repository.CourseRepository;
import com.aitutor.repository.LessonRepository;
import com.aitutor.repository.ProgressRepository;
import com.aitutor.repository.UserRepository;
import com.aitutor.security.JwtService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.nio.file.*;
import java.io.IOException;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final UserRepository users;
    private final CourseRepository courses;
    private final LessonRepository lessons;
    private final ProgressRepository progress;
    private final QuizQuestionRepository quizzes;
    private final ConversationRepository conversations;
    private final MessageRepository messages;
    private final PasswordEncoder encoder;
    private final String adminEmail;
    private final JwtService jwt;
    private final GateNoteRepository gateNotes;
    private final Path legacyGateNotesDir;
    private final AuditLogRepository auditLogs;
    private final AnnouncementRepository announcements;
    private final AppMetaRepository meta;
    private final QuizAttemptRepository attempts;
    private final CommunityPostRepository communityPosts;
    private final com.aitutor.intelligence.LearningEventRepository learningEvents;
    private final com.aitutor.dsa.DsaProblemStateRepository dsaStates;
    private final com.aitutor.rag.KnowledgeDocumentRepository knowledgeDocs;
    private final com.aitutor.rag.KnowledgeChunkRepository knowledgeChunks;
    private final com.aitutor.ai.AiMetrics aiMetrics;
    private final RemoteCodeRunner remoteRunner;
    private final com.aitutor.service.UserDataCleanupService userCleanup;
    private final long maxGateUploadBytes;

    public AdminController(UserRepository users, CourseRepository courses, LessonRepository lessons,
                           ProgressRepository progress, QuizQuestionRepository quizzes,
                           ConversationRepository conversations, MessageRepository messages,
                           PasswordEncoder encoder,
                           @Value("${app.admin.email:}") String adminEmail, JwtService jwt, GateNoteRepository gateNotes,
                           @Value("${app.gate.notes-dir:./gate-notes}") String gateNotesDir,
                           @Value("${app.gate.max-upload-bytes:5242880}") long maxGateUploadBytes,
                           AuditLogRepository auditLogs, AnnouncementRepository announcements, AppMetaRepository meta, QuizAttemptRepository attempts, CommunityPostRepository communityPosts,
                           com.aitutor.intelligence.LearningEventRepository learningEvents,
                           com.aitutor.dsa.DsaProblemStateRepository dsaStates,
                           com.aitutor.rag.KnowledgeDocumentRepository knowledgeDocs,
                           com.aitutor.rag.KnowledgeChunkRepository knowledgeChunks,
                           com.aitutor.ai.AiMetrics aiMetrics,
                           RemoteCodeRunner remoteRunner,
                           com.aitutor.service.UserDataCleanupService userCleanup) {
        this.users = users; this.courses = courses; this.lessons = lessons; this.progress = progress;
        this.quizzes = quizzes; this.conversations = conversations; this.messages = messages;
        this.encoder = encoder; this.adminEmail = adminEmail == null ? "" : adminEmail.trim().toLowerCase(); this.jwt = jwt;
        this.gateNotes = gateNotes;
        this.legacyGateNotesDir = Paths.get(gateNotesDir).toAbsolutePath().normalize();
        this.maxGateUploadBytes = Math.max(256L * 1024L, maxGateUploadBytes);
        this.auditLogs=auditLogs; this.announcements=announcements; this.meta=meta; this.attempts=attempts; this.communityPosts=communityPosts;
        this.learningEvents=learningEvents; this.dsaStates=dsaStates; this.knowledgeDocs=knowledgeDocs; this.knowledgeChunks=knowledgeChunks;
        this.aiMetrics=aiMetrics; this.remoteRunner=remoteRunner; this.userCleanup=userCleanup;
        try { Files.createDirectories(this.legacyGateNotesDir); } catch (Exception e) { throw new IllegalStateException("Could not initialize GATE notes storage", e); }
        migrateLegacyGateNotes();
    }

    private User admin(@RequestHeader(value = "Authorization", required = false) String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Admin sign-in required");
        }
        try {
            JwtService.ParsedToken parsed = jwt.parse(authorization.substring(7));
            if (!jwt.isSessionWithinAbsoluteLimit(parsed.sessionStartedAtMs())) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Admin session expired");
            }
            User u = users.findByEmail(parsed.email()).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Admin account not found"));
            if (!u.isActive() || u.isBlocked() || !u.isEmailVerified()) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Admin account is not active");
            }
            if (!jwt.matchesPassword(u, parsed.passwordFingerprint())) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Admin session revoked");
            }
            if (!"ADMIN".equalsIgnoreCase(u.getRole())) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Admin access required");
            }
            return u;
        } catch (io.jsonwebtoken.JwtException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired admin session");
        }
    }

    private void audit(User admin,String action,String target,String status,String details){
        try { auditLogs.save(new AuditLog(admin.getEmail(),action,target,status,details)); } catch(Exception ignored) {}
    }

    @GetMapping("/dashboard")
    public Map<String,Object> dashboard(@RequestHeader(value="Authorization", required=false) String authorization){
        User me=admin(authorization);
        long publishedCourses=courses.findAll().stream().filter(Course::isPublished).count();
        // Guests are disposable sessions, not platform accounts; counting them
        // would inflate the owner dashboard every time someone browses.
        long activeUsers=users.countByRoleNotAndActiveTrue("GUEST");
        long blockedUsers=users.countByRoleNotAndBlockedTrue("GUEST");
        return Map.of("users",users.countByRoleNot("GUEST"),"activeUsers",activeUsers,"blockedUsers",blockedUsers,"courses",courses.count(),"publishedCourses",publishedCourses,"lessons",lessons.count(),"questions",quizzes.count(),"attempts",attempts.count(),"auditEvents",auditLogs.count(),"adminEmail",me.getEmail());
    }

    @GetMapping("/overview")
    public Map<String,Object> overview(@RequestHeader(value="Authorization", required=false) String authorization) {
        admin(authorization);
        return Map.of("users", users.count(), "courses", courses.count(), "lessons", lessons.count(), "adminEmail", adminEmail);
    }

    @GetMapping("/courses")
    public List<Course> allCourses(@RequestHeader(value="Authorization", required=false) String authorization) {
        admin(authorization);
        return courses.findAll();
    }

    @GetMapping("/monitor")
    public Map<String,Object> monitor(@RequestHeader(value="Authorization", required=false) String authorization) {
        admin(authorization);
        List<UserView> recent = users.findTop8ByRoleNotOrderByCreatedAtDesc("GUEST").stream()
                .map(u -> new UserView(u.getId(), u.getName(), u.getEmail(), u.getRole(), u.getCreatedAt(), u.isActive(), u.isBlocked(), u.isEmailVerified())).toList();
        List<Map<String,Object>> curriculum = courses.findAll().stream().map(c -> {
            Map<String,Object> row = new LinkedHashMap<>();
            row.put("id", c.getId()); row.put("title", c.getTitle()); row.put("level", c.getLevel());
            row.put("lessons", lessons.countByCourseId(c.getId()));
            return row;
        }).toList();
        return Map.of("users", users.countByRoleNot("GUEST"), "courses", courses.count(), "lessons", lessons.count(), "recentUsers", recent, "curriculum", curriculum);
    }

    @GetMapping("/users")
    public List<UserView> userList(@RequestHeader(value="Authorization", required=false) String authorization) {
        admin(authorization);
        return users.findByRoleNotOrderByNameAsc("GUEST").stream()
                .map(u -> new UserView(u.getId(), u.getName(), u.getEmail(), u.getRole(), u.getCreatedAt(), u.isActive(), u.isBlocked(), u.isEmailVerified())).toList();
    }

    /**
     * Manual verification for the support path used when email delivery is
     * unavailable. The administrator has verified ownership out of band; the
     * action is auditable and never grants ADMIN.
     */
    @PostMapping("/users/{userId}/verify-email")
    public Map<String,Object> verifyUserEmail(@RequestHeader(value = "Authorization", required = false) String authorization,
                                              @PathVariable Long userId) {
        User me = admin(authorization);
        User u = users.findById(userId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
        boolean already = u.isEmailVerified();
        if (!already) {
            u.setEmailVerified(true);
            u.setVerificationTokenHash(null);
            u.setVerificationExpiresAt(null);
            u.setVerificationSentAt(null);
            users.save(u);
        }
        audit(me, "EMAIL_VERIFIED_MANUALLY", String.valueOf(userId), "SUCCESS",
                already ? "Already verified" : "Verified by administrator after an out-of-band ownership check.");
        return Map.of("id", u.getId(), "emailVerified", true, "alreadyVerified", already);
    }

    @PatchMapping("/users/{userId}/status")
    public Map<String,Object> updateUserStatus(@RequestHeader(value="Authorization", required=false) String authorization,@PathVariable Long userId,@RequestBody UserStatusRequest r){
        User me=admin(authorization); User u=users.findById(userId).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Student not found"));
        if("ADMIN".equalsIgnoreCase(u.getRole()) || u.getEmail().equalsIgnoreCase(adminEmail)) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Owner/admin account is protected");
        if(r.active()!=null) u.setActive(r.active()); if(r.blocked()!=null) u.setBlocked(r.blocked()); users.save(u);
        audit(me,"USER_STATUS",String.valueOf(userId),"SUCCESS","active="+u.isActive()+", blocked="+u.isBlocked());
        return Map.of("id",u.getId(),"active",u.isActive(),"blocked",u.isBlocked());
    }

    @PatchMapping("/users/{userId}/role")
    public Map<String,Object> updateUserRole(@RequestHeader(value="Authorization", required=false) String authorization,@PathVariable Long userId,@RequestBody RoleRequest r){
        User me=admin(authorization); User u=users.findById(userId).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"User not found"));
        if(u.getEmail().equalsIgnoreCase(adminEmail) || Objects.equals(me.getId(),u.getId())) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Owner account cannot be changed");
        if(com.aitutor.service.GuestService.ROLE.equalsIgnoreCase(u.getRole())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Guest accounts cannot be promoted or modified");
        String role=r.role()==null?"STUDENT":r.role().trim().toUpperCase(Locale.ROOT); if(!Set.of("STUDENT","ADMIN").contains(role)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Unsupported role");
        u.setRole(role); users.save(u); audit(me,"ROLE_CHANGED",String.valueOf(userId),"SUCCESS",role); return Map.of("id",u.getId(),"role",u.getRole());
    }

    @GetMapping("/ai/usage")
    public Map<String,Object> aiUsage(@RequestHeader(value="Authorization", required=false) String authorization) {
        admin(authorization);
        String todayKey = "ai_daily_usage_" + java.time.LocalDate.now(java.time.ZoneOffset.UTC);
        try {
            var stored = meta.findById(todayKey);
            long storedCount = stored.map(m -> {
                try { return Long.parseLong(m.getValue().trim()); } catch (Exception e) { return 0L; }
            }).orElse(0L);
            long memCount = aiMetrics.getTodayRequests();
            if (storedCount > memCount) {
                aiMetrics.setTodayBase(storedCount);
            } else if (memCount > storedCount) {
                meta.save(new AppMeta(todayKey, String.valueOf(memCount)));
            }
            meta.findById("ai.dailyLimit").ifPresent(m -> {
                try {
                    int lim = Integer.parseInt(m.getValue().trim());
                    if (lim > 0) aiMetrics.setDailyLimit(lim);
                } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {}
        return aiMetrics.snapshot();
    }

    @GetMapping("/sandbox/usage")
    public Map<String,Object> sandboxUsage(@RequestHeader(value="Authorization", required=false) String authorization) {
        admin(authorization);
        return remoteRunner.stats();
    }

    @GetMapping("/audit-logs")
    public List<AuditLog> audit(@RequestHeader(value="Authorization", required=false) String authorization){ admin(authorization); return auditLogs.findTop200ByOrderByCreatedAtDesc(); }

    @GetMapping("/community/posts")
    public List<Map<String,Object>> communityPosts(@RequestHeader(value="Authorization", required=false) String authorization) {
        admin(authorization);
        return communityPosts.findRecentWithUser(org.springframework.data.domain.PageRequest.of(0, 100)).stream().map(p -> {
            Map<String,Object> m=new LinkedHashMap<>();
            m.put("id",p.getId());
            m.put("author",p.getUser().getName());
            m.put("text",p.getText());
            m.put("createdAt",p.getCreatedAt());
            return m;
        }).toList();
    }

    @DeleteMapping("/community/posts/{id}")
    public Map<String,Object> deleteCommunityPost(@RequestHeader(value="Authorization", required=false) String authorization, @PathVariable Long id) {
        User me=admin(authorization);
        if(!communityPosts.existsById(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Community post not found");
        communityPosts.deleteById(id);
        audit(me,"COMMUNITY_POST_DELETED",String.valueOf(id),"SUCCESS",null);
        return Map.of("deleted",true,"id",id);
    }

    @DeleteMapping("/community/posts")
    @Transactional
    public Map<String,Object> clearCommunityPosts(@RequestHeader(value="Authorization", required=false) String authorization) {
        User me=admin(authorization);
        long count=communityPosts.count();
        communityPosts.deleteAllInBatch();
        audit(me,"COMMUNITY_FEED_CLEARED","all","SUCCESS","deleted="+count);
        return Map.of("deleted",true,"count",count);
    }

    @GetMapping("/announcements")
    public List<Announcement> announcements(@RequestHeader(value="Authorization", required=false) String authorization){ admin(authorization); return announcements.findTop100ByOrderByCreatedAtDesc(); }

    @PostMapping("/announcements")
    public Announcement createAnnouncement(@RequestHeader(value="Authorization", required=false) String authorization,@RequestBody AnnouncementRequest r){
        User me=admin(authorization); if(r.title()==null||r.title().isBlank()||r.message()==null||r.message().isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Title and message are required");
        Announcement a=announcements.save(new Announcement(r.title().trim(),r.message().trim(),r.target()==null?"ALL":r.target().trim().toUpperCase(Locale.ROOT),r.published())); audit(me,"ANNOUNCEMENT_CREATED",String.valueOf(a.getId()),"SUCCESS",a.getTitle()); return a;
    }

    @PutMapping("/announcements/{id}")
    public Announcement updateAnnouncement(@RequestHeader(value="Authorization", required=false) String authorization,@PathVariable Long id,@RequestBody AnnouncementRequest r){
        User me=admin(authorization); Announcement a=announcements.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Announcement not found"));
        if(r.title()!=null&&!r.title().isBlank())a.setTitle(r.title().trim()); if(r.message()!=null&&!r.message().isBlank())a.setMessage(r.message().trim()); if(r.target()!=null&&!r.target().isBlank())a.setTarget(r.target().trim().toUpperCase(Locale.ROOT)); a.setPublished(r.published()); announcements.save(a); audit(me,"ANNOUNCEMENT_UPDATED",String.valueOf(id),"SUCCESS",a.getTitle()); return a;
    }

    @DeleteMapping("/announcements/{id}")
    public Map<String,Object> deleteAnnouncement(@RequestHeader(value="Authorization", required=false) String authorization,@PathVariable Long id){ User me=admin(authorization); if(!announcements.existsById(id))throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Announcement not found"); announcements.deleteById(id); audit(me,"ANNOUNCEMENT_DELETED",String.valueOf(id),"SUCCESS",null); return Map.of("deleted",true); }

    @GetMapping("/settings")
    public Map<String,String> settings(@RequestHeader(value="Authorization", required=false) String authorization){ admin(authorization); Map<String,String> out=new LinkedHashMap<>(); meta.findAll().forEach(x->{ if(!x.getKey().startsWith("secret.")) out.put(x.getKey(),x.getValue()); }); return out; }

    @PutMapping("/settings")
    public Map<String,String> saveSettings(@RequestHeader(value="Authorization", required=false) String authorization,@RequestBody Map<String,String> values){
        User me=admin(authorization);
        values.forEach((k,v)->{
            if(k==null||v==null||k.toLowerCase(Locale.ROOT).contains("secret")||k.toLowerCase(Locale.ROOT).contains("password")||k.toLowerCase(Locale.ROOT).contains("token")) return;
            meta.save(new AppMeta(k,v.length()>500?v.substring(0,500):v));
            if("ai.dailyLimit".equalsIgnoreCase(k)) {
                try {
                    int lim = Integer.parseInt(v.trim());
                    if (lim > 0) aiMetrics.setDailyLimit(lim);
                } catch (Exception ignored) {}
            }
        });
        audit(me,"SETTINGS_CHANGED","platform","SUCCESS",String.join(",",values.keySet()));
        return settings(authorization);
    }

    @GetMapping("/questions")
    public List<Map<String,Object>> questions(@RequestHeader(value="Authorization", required=false) String authorization){ admin(authorization); return quizzes.findAll().stream().map(q->{Map<String,Object> m=new LinkedHashMap<>();m.put("id",q.getId());m.put("courseId",q.getCourse().getId());m.put("course",q.getCourse().getTitle());m.put("question",q.getQuestion());m.put("optionA",q.getOptionA());m.put("optionB",q.getOptionB());m.put("optionC",q.getOptionC());m.put("optionD",q.getOptionD());m.put("correctOption",q.getCorrectOption());m.put("explanation",q.getExplanation());m.put("difficulty",q.getDifficulty());return m;}).toList(); }

    @PostMapping("/questions")
    public Map<String,Object> createQuestion(@RequestHeader(value="Authorization", required=false) String authorization,@RequestBody QuestionRequest r){ User me=admin(authorization); Course c=courses.findById(r.courseId()).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Course not found")); if(r.question()==null||r.question().isBlank())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Question is required"); QuizQuestion q=new com.aitutor.quiz.QuizQuestion();q.setCourse(c);q.setQuestion(r.question().trim());q.setOptionA(r.optionA());q.setOptionB(r.optionB());q.setOptionC(r.optionC());q.setOptionD(r.optionD());q.setCorrectOption(r.correctOption());q.setExplanation(r.explanation());q.setDifficulty(r.difficulty()); q=quizzes.save(q); audit(me,"QUESTION_CREATED",String.valueOf(q.getId()),"SUCCESS",c.getTitle()); return questionView(q); }

    @PutMapping("/questions/{id}")
    public Map<String,Object> updateQuestion(@RequestHeader(value="Authorization", required=false) String authorization,@PathVariable Long id,@RequestBody QuestionRequest r){ User me=admin(authorization); var q=quizzes.findById(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Question not found")); if(r.courseId()!=null)q.setCourse(courses.findById(r.courseId()).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Course not found"))); if(r.question()!=null&&!r.question().isBlank())q.setQuestion(r.question().trim());q.setOptionA(r.optionA());q.setOptionB(r.optionB());q.setOptionC(r.optionC());q.setOptionD(r.optionD());q.setCorrectOption(r.correctOption());q.setExplanation(r.explanation());q.setDifficulty(r.difficulty());quizzes.save(q);audit(me,"QUESTION_UPDATED",String.valueOf(id),"SUCCESS",q.getCourse().getTitle());return questionView(q); }

    @DeleteMapping("/questions/{id}")
    public Map<String,Object> deleteQuestion(@RequestHeader(value="Authorization", required=false) String authorization,@PathVariable Long id){ User me=admin(authorization); if(!quizzes.existsById(id))throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Question not found"); quizzes.deleteById(id);audit(me,"QUESTION_DELETED",String.valueOf(id),"SUCCESS",null);return Map.of("deleted",true); }

    private Map<String,Object> questionView(com.aitutor.quiz.QuizQuestion q){ Map<String,Object> m=new LinkedHashMap<>();m.put("id",q.getId());m.put("courseId",q.getCourse().getId());m.put("course",q.getCourse().getTitle());m.put("question",q.getQuestion());m.put("optionA",q.getOptionA());m.put("optionB",q.getOptionB());m.put("optionC",q.getOptionC());m.put("optionD",q.getOptionD());m.put("correctOption",q.getCorrectOption());m.put("explanation",q.getExplanation());m.put("difficulty",q.getDifficulty());return m; }

    @PatchMapping("/courses/{courseId}/publish")
    public Map<String,Object> publishCourse(@RequestHeader(value="Authorization", required=false) String authorization,@PathVariable Long courseId,@RequestParam boolean published){ User me=admin(authorization); Course c=courses.findById(courseId).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Course not found")); c.setPublished(published);courses.save(c);audit(me,published?"COURSE_PUBLISHED":"COURSE_UNPUBLISHED",String.valueOf(courseId),"SUCCESS",c.getTitle());return Map.of("id",courseId,"published",published); }

    @GetMapping("/gate-notes")
    public List<Map<String,Object>> gateNotes(@RequestHeader(value="Authorization", required=false) String authorization) {
        admin(authorization);
        return gateNotes.findAllMetadataOrderBySubjectKeyAscFilenameAsc().stream()
                .map(this::gateNoteSummaryView)
                .toList();
    }

    @PostMapping(value="/gate-notes", consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String,Object> uploadGateNote(@RequestHeader(value="Authorization", required=false) String authorization,
                                             @RequestParam("subject") String subject,
                                             @RequestPart("file") MultipartFile file) {
        admin(authorization);
        String cleanSubject = subject == null ? "" : subject.trim();
        if (cleanSubject.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Subject is required");
        if (file == null || file.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a PDF file");
        String originalName = file.getOriginalFilename() == null ? "notes.pdf" : file.getOriginalFilename().trim();
        String lowerName = originalName.toLowerCase(Locale.ROOT);
        String type = file.getContentType() == null ? "" : file.getContentType().toLowerCase(Locale.ROOT);
        if (!lowerName.endsWith(".pdf") && !type.equals("application/pdf")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only PDF files are allowed");
        if (file.getSize() > maxGateUploadBytes) {
            long maxMb = Math.max(1, maxGateUploadBytes / (1024L * 1024L));
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                    "PDF must be " + maxMb + " MB or smaller for database storage");
        }
        String safeSubject = cleanSubject.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        if (safeSubject.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid subject name");
        String safeOriginal = Paths.get(originalName).getFileName().toString().replaceAll("[^A-Za-z0-9._-]", "_");
        if (!safeOriginal.toLowerCase(Locale.ROOT).endsWith(".pdf")) safeOriginal += ".pdf";
        String uniqueName = safeSubject + "--" + UUID.randomUUID().toString().substring(0, 8) + "--" + safeOriginal;
        try {
            byte[] bytes = file.getBytes();
            if (bytes.length < 5 || bytes[0] != '%' || bytes[1] != 'P' || bytes[2] != 'D' || bytes[3] != 'F' || bytes[4] != '-') {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Uploaded file is not a valid PDF document");
            }
            GateNote saved = gateNotes.save(new GateNote(safeSubject, uniqueName, "application/pdf", bytes));
            return gateNoteView(saved);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not read GATE PDF");
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not save GATE PDF");
        }
    }

    @DeleteMapping("/gate-notes/{filename:.+}")
    public Map<String,Object> deleteGateNote(@RequestHeader(value="Authorization", required=false) String authorization,
                                             @PathVariable String filename) {
        admin(authorization);
        String safe = Paths.get(filename).getFileName().toString();
        if (!safe.toLowerCase(Locale.ROOT).endsWith(".pdf")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid PDF filename");
        GateNote note = gateNotes.findByFilename(safe)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "GATE PDF not found"));
        gateNotes.delete(note);
        return Map.of("deleted", true, "filename", safe);
    }

    private void migrateLegacyGateNotes() {
        try (var stream = Files.list(legacyGateNotesDir)) {
            stream.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".pdf"))
                    .forEach(path -> {
                        String filename = path.getFileName().toString();
                        if (gateNotes.existsByFilename(filename)) return;
                        String base = filename.substring(0, filename.length() - 4);
                        int separator = base.indexOf("--");
                        String subjectKey = separator > 0 ? base.substring(0, separator) : base;
                        try {
                            if (Files.size(path) > maxGateUploadBytes) return;
                            gateNotes.save(new GateNote(subjectKey, filename, "application/pdf", Files.readAllBytes(path)));
                        } catch (Exception ignored) {
                            // Keep legacy file in place if migration fails; it can be retried next startup.
                        }
                    });
        } catch (Exception ignored) {
            // Database-backed notes remain the source of truth.
        }
    }

    private Map<String,Object> gateNoteSummaryView(GateNoteRepository.GateNoteSummary note) {
        Map<String,Object> view = new LinkedHashMap<>();
        view.put("filename", note.getFilename());
        view.put("subject", note.getSubjectKey().replace('-', ' '));
        view.put("subjectKey", note.getSubjectKey());
        view.put("sizeBytes", note.getSizeBytes());
        view.put("uploadedAt", note.getUploadedAt());
        view.put("url", "/api/gate-cse/notes/" + note.getFilename());
        return view;
    }

    private Map<String,Object> gateNoteView(GateNote note) {
        Map<String,Object> view = new LinkedHashMap<>();
        view.put("filename", note.getFilename());
        view.put("subject", note.getSubjectKey().replace('-', ' '));
        view.put("subjectKey", note.getSubjectKey());
        view.put("sizeBytes", note.getSizeBytes());
        view.put("uploadedAt", note.getUploadedAt());
        view.put("url", "/api/gate-cse/notes/" + note.getFilename());
        return view;
    }

    @PostMapping("/courses")
    public Course createCourse(@RequestHeader(value="Authorization", required=false) String authorization, @RequestBody CourseRequest r) {
        User me = admin(authorization);
        if (r.title() == null || r.title().isBlank()) throw new IllegalArgumentException("Course title is required");
        Course c = new Course(r.title().trim(), r.description(), r.level() == null ? "Beginner" : r.level(), r.icon() == null ? "✦" : r.icon());
        c.setTotalLessons(0);
        Course saved=courses.save(c); audit(me,"COURSE_CREATED",String.valueOf(saved.getId()),"SUCCESS",saved.getTitle()); return saved;
    }

    @PutMapping("/courses/{courseId}")
    public Course updateCourse(@RequestHeader(value="Authorization", required=false) String authorization, @PathVariable Long courseId, @RequestBody CourseRequest r) {
        User me = admin(authorization);
        Course c = courses.findById(courseId).orElseThrow(() -> new IllegalArgumentException("Course not found"));
        if (r.title() != null && !r.title().isBlank()) c.setTitle(r.title().trim());
        if (r.description() != null) c.setDescription(r.description().trim());
        if (r.level() != null && !r.level().isBlank()) c.setLevel(r.level());
        if (r.icon() != null && !r.icon().isBlank()) c.setIcon(r.icon());
        Course saved=courses.save(c); audit(me,"COURSE_UPDATED",String.valueOf(courseId),"SUCCESS",saved.getTitle()); return saved;
    }

    @DeleteMapping("/courses/{courseId}")
    @Transactional
    public Map<String,Object> deleteCourse(@RequestHeader(value="Authorization", required=false) String authorization, @PathVariable Long courseId) {
        User me=admin(authorization);
        Course c = courses.findById(courseId).orElseThrow(() -> new IllegalArgumentException("Course not found"));
        attempts.deleteByCourseId(courseId);
        progress.deleteByCourseId(courseId);
        quizzes.deleteByCourseId(courseId);
        lessons.deleteByCourseId(courseId);
        courses.delete(c);
        audit(me,"COURSE_DELETED",String.valueOf(courseId),"SUCCESS",c.getTitle());
        return Map.of("deleted", true, "courseId", courseId, "title", c.getTitle());
    }

    @PostMapping("/courses/{courseId}/lessons")
    @Transactional
    public Lesson createLesson(@RequestHeader(value="Authorization", required=false) String authorization, @PathVariable Long courseId, @RequestBody LessonRequest r) {
        admin(authorization);
        Course c = courses.findById(courseId).orElseThrow(() -> new IllegalArgumentException("Course not found"));
        if (r.title() == null || r.title().isBlank()) throw new IllegalArgumentException("Lesson title is required");
        int next = lessons.findByCourseIdOrderByOrderIndex(courseId).stream().mapToInt(x -> x.getOrderIndex() == null ? 0 : x.getOrderIndex()).max().orElse(0) + 1;
        Lesson l = new Lesson(); l.setCourse(c); l.setTitle(r.title().trim()); l.setTopic(r.topic() == null || r.topic().isBlank() ? "Core Concepts" : r.topic().trim()); l.setOrderIndex(next); l.setContent(r.content() == null ? "" : r.content());
        Lesson saved = lessons.save(l);
        int total = (int) lessons.countByCourseId(courseId);
        c.setTotalLessons(total);
        courses.save(c);
        reconcileCourseProgress(courseId, total);
        return saved;
    }

    @PutMapping("/lessons/{lessonId}")
    public Lesson updateLesson(@RequestHeader(value="Authorization", required=false) String authorization, @PathVariable Long lessonId, @RequestBody LessonRequest r) {
        admin(authorization);
        Lesson l = lessons.findById(lessonId).orElseThrow(() -> new IllegalArgumentException("Lesson not found"));
        if (r.title() != null && !r.title().isBlank()) l.setTitle(r.title().trim());
        if (r.topic() != null && !r.topic().isBlank()) l.setTopic(r.topic().trim());
        if (r.content() != null) l.setContent(r.content());
        return lessons.save(l);
    }

    @DeleteMapping("/lessons/{lessonId}")
    @Transactional
    public Map<String,Object> deleteLesson(@RequestHeader(value="Authorization", required=false) String authorization, @PathVariable Long lessonId) {
        admin(authorization);
        Lesson l = lessons.findById(lessonId).orElseThrow(() -> new IllegalArgumentException("Lesson not found"));
        Long courseId = l.getCourse().getId();
        lessons.delete(l);
        List<Lesson> remaining = lessons.findByCourseIdOrderByOrderIndex(courseId);
        for (int i = 0; i < remaining.size(); i++) { remaining.get(i).setOrderIndex(i + 1); }
        lessons.saveAll(remaining);
        int total = remaining.size();
        courses.findById(courseId).ifPresent(c -> { c.setTotalLessons(total); courses.save(c); });
        reconcileCourseProgress(courseId, total);
        return Map.of("deleted", true, "lessonId", lessonId);
    }

    private void reconcileCourseProgress(Long courseId, int newTotal) {
        List<Progress> rows = progress.findByCourseId(courseId);
        if (rows.isEmpty()) return;
        for (Progress p : rows) {
            int clamped = Math.min(Math.max(0, p.getCompletedLessons()), newTotal);
            p.setCompletedLessons(clamped);
            p.setTotalLessons(newTotal);
            p.setPercent(newTotal <= 0 ? 0.0 : (clamped * 100.0 / newTotal));
        }
        progress.saveAll(rows);
    }

    @PutMapping("/courses/{courseId}/lessons/reorder")
    @Transactional
    public Map<String,Object> reorderLessons(@RequestHeader(value="Authorization", required=false) String authorization,@PathVariable Long courseId,@RequestBody List<Long> ids){ User me=admin(authorization); List<Lesson> list=lessons.findByCourseIdOrderByOrderIndex(courseId); Map<Long,Lesson> byId=new HashMap<>();list.forEach(l->byId.put(l.getId(),l));int order=1;for(Long id:ids){Lesson l=byId.remove(id);if(l!=null)l.setOrderIndex(order++);}for(Lesson l:byId.values())l.setOrderIndex(order++);lessons.saveAll(list);audit(me,"LESSONS_REORDERED",String.valueOf(courseId),"SUCCESS",null);return Map.of("updated",true); }

    @PostMapping("/users/{userId}/reset-password")
    public Map<String,Object> resetStudentPassword(@RequestHeader(value="Authorization", required=false) String authorization,
                                                     @PathVariable Long userId, @RequestBody ResetPasswordRequest r) {
        User me = admin(authorization);
        User u = users.findById(userId).orElseThrow(() -> new IllegalArgumentException("Student not found"));
        if ("ADMIN".equalsIgnoreCase(u.getRole())) throw new IllegalArgumentException("Admin password cannot be reset from student management");
        if (r.newPassword() == null || r.newPassword().length() < 6) throw new IllegalArgumentException("Password must be at least 6 characters");
        if (r.newPassword().length() > 128) throw new IllegalArgumentException("Password is too long");
        u.setPassword(encoder.encode(r.newPassword())); users.save(u);
        audit(me,"PASSWORD_RESET",String.valueOf(userId),"SUCCESS","Set by an administrator for account recovery; prior JWT sessions immediately invalidated.");
        return Map.of("updated", true, "userId", userId);
    }

    @DeleteMapping("/users/{userId}")
    @Transactional
    public Map<String,Object> deleteStudent(@RequestHeader(value="Authorization", required=false) String authorization, @PathVariable Long userId) {
        User me = admin(authorization);
        User u = users.findById(userId).orElseThrow(() -> new IllegalArgumentException("Student not found"));
        if (Objects.equals(me.getId(), u.getId()) || "ADMIN".equalsIgnoreCase(u.getRole()) || u.getEmail().equalsIgnoreCase(adminEmail)) {
            throw new IllegalArgumentException("The owner/admin account cannot be deleted here");
        }
        String email = u.getEmail();
        // One shared cascade for admin and guest deletion. Every user-owned table
        // is cleared before the user row, so no foreign key can abort deletion.
        userCleanup.deleteUserAndData(u);
        audit(me,"USER_DELETED",String.valueOf(userId),"SUCCESS",email);
        return Map.of("deleted", true, "userId", userId);
    }

    /**
     * All-or-nothing bulk deletion for the admin user table. Protected records
     * are reported and skipped; if any real deletion fails the transaction rolls
     * back, so the response can never claim records were removed when they were not.
     */
    @PostMapping("/users/bulk-delete")
    @Transactional
    public Map<String,Object> bulkDeleteUsers(@RequestHeader(value="Authorization", required=false) String authorization,
                                              @RequestBody BulkDeleteRequest r) {
        User me = admin(authorization);
        List<Long> ids = r == null || r.ids() == null ? List.of() : r.ids().stream().filter(Objects::nonNull).distinct().limit(100).toList();
        if (ids.isEmpty()) throw new IllegalArgumentException("Select at least one student");
        List<Long> deleted = new ArrayList<>();
        List<Map<String,Object>> skipped = new ArrayList<>();
        for (Long id : ids) {
            Optional<User> found = users.findById(id);
            if (found.isEmpty()) { skipped.add(Map.of("id", id, "reason", "not found")); continue; }
            User u = found.get();
            if (Objects.equals(me.getId(), u.getId()) || "ADMIN".equalsIgnoreCase(u.getRole())
                    || u.getEmail().equalsIgnoreCase(adminEmail)) {
                skipped.add(Map.of("id", id, "reason", "protected account")); continue;
            }
            String email = u.getEmail();
            userCleanup.deleteUserAndData(u);
            deleted.add(id);
            audit(me, "USER_DELETED", String.valueOf(id), "SUCCESS", email + " (bulk)");
        }
        return Map.of("deleted", deleted, "deletedCount", deleted.size(), "skipped", skipped);
    }

    public record UserView(Long id,String name,String email,String role, LocalDateTime createdAt, boolean active, boolean blocked, boolean emailVerified) {}
    public record CourseRequest(String title,String description,String level,String icon) {}
    public record LessonRequest(String title,String topic,String content) {}
    public record ResetPasswordRequest(String newPassword) {}
    public record BulkDeleteRequest(List<Long> ids) {}
    public record UserStatusRequest(Boolean active, Boolean blocked) {}
    public record RoleRequest(String role) {}
    public record AnnouncementRequest(String title,String message,String target,boolean published) {}
    public record QuestionRequest(Long courseId,String question,String optionA,String optionB,String optionC,String optionD,int correctOption,String explanation,String difficulty) {}
}
