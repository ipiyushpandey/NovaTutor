package com.aitutor.config;

import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Ensures database migration runner executes BEFORE EntityManagerFactory initialization.
 * This guarantees that critical tables and columns exist before Hibernate validates the schema.
 */
@Configuration
public class DatabaseMigrationConfig {

    @Bean
    public static BeanFactoryPostProcessor entityManagerFactoryDependsOnMigration() {
        return beanFactory -> {
            if (beanFactory.containsBeanDefinition("entityManagerFactory")) {
                BeanDefinition bd = beanFactory.getBeanDefinition("entityManagerFactory");
                String[] dependsOn = bd.getDependsOn();
                if (dependsOn == null || dependsOn.length == 0) {
                    bd.setDependsOn("databaseMigrationRunner");
                } else {
                    List<String> list = new ArrayList<>(Arrays.asList(dependsOn));
                    if (!list.contains("databaseMigrationRunner")) {
                        list.add("databaseMigrationRunner");
                        bd.setDependsOn(list.toArray(new String[0]));
                    }
                }
            }
        };
    }
}
