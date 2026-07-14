FROM maven:3.9.9-eclipse-temurin-21 AS build

WORKDIR /app
COPY pom.xml .
RUN mvn --batch-mode dependency:go-offline
COPY src ./src
RUN mvn --batch-mode clean package -DskipTests

FROM eclipse-temurin:21-jre

WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system pearprogram \
    && useradd --system --gid pearprogram --home-dir /app pearprogram

COPY --from=build --chown=pearprogram:pearprogram /app/target/backend-0.1.0-SNAPSHOT.jar app.jar

USER pearprogram
EXPOSE 8081

HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=4 \
  CMD curl --fail --silent http://127.0.0.1:8081/healthz >/dev/null || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
