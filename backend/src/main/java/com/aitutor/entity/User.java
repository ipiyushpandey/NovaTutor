package com.aitutor.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity @Table(name="users") @Getter @Setter @NoArgsConstructor
public class User {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
 @Column(nullable=false, unique=true) private String email;
 @JsonIgnore @Column(nullable=false) private String password;
 @Column(nullable=false) private String name;
 @Column(nullable=false) private String role="STUDENT";
 private LocalDateTime createdAt=LocalDateTime.now();
 private String educationLevel;
 private String learningGoal;
 private String targetExam;
 @Column(length=1000) private String interests;
 @Column(length=1000) private String strengths;
 @Column(length=1000) private String weaknesses;
 private String learningStyle;
 private Integer dailyStudyMinutes;
 private String preferredAiLanguage;
 @Column(nullable=false, columnDefinition="boolean default true") private boolean active=true;
 @Column(nullable=false, columnDefinition="boolean default false") private boolean blocked=false;
 /* Email ownership. The column default is TRUE so every account that existed
    before email verification was introduced keeps working; new registrations
    explicitly set false until they click the emailed link. */
 @Column(nullable=false, columnDefinition="boolean default true") private boolean emailVerified=false;
 @JsonIgnore @Column(length=200) private String googleSubject;
 @JsonIgnore @Column(length=64) private String verificationTokenHash;
 @JsonIgnore private LocalDateTime verificationExpiresAt;
 @JsonIgnore private LocalDateTime verificationSentAt;
 @JsonIgnore @Column(length=64) private String resetTokenHash;
 @JsonIgnore private LocalDateTime resetExpiresAt;
 public User(String name,String email,String password){this.name=name;this.email=email;this.password=password;}
}
