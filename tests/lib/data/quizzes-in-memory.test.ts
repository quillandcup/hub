import { InMemoryQuizRepository } from "@/lib/data/quizzes";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineQuizContract } from "@/tests/helpers/quiz-contract";
import { lessonRow } from "../../helpers/course-fixtures";

const data = new InMemoryDataset({
  courseLessons: [
    lessonRow({ id: "les_AAAAAAAAAAK1", course_id: "crs_AAAAAAAAAAA1", title: "Imported one", source: "kajabi", source_key: "k1" }),
    lessonRow({ id: "les_AAAAAAAAAAK2", course_id: "crs_AAAAAAAAAAA1", title: "Imported two", source: "kajabi", source_key: "k2" }),
  ],
});

defineQuizContract("InMemoryQuizRepository", () => ({
  repo: () => new InMemoryQuizRepository(data),
  lessons: ["les_AAAAAAAAAAA1", "les_AAAAAAAAAAA2"],
  kajabiLessons: ["les_AAAAAAAAAAK1", "les_AAAAAAAAAAK2"],
  members: ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"],
  clear: async () => {
    data.quizzes = [];
    data.quizQuestions = [];
    data.quizOptions = [];
    data.quizAttempts = [];
    data.quizAttemptAnswers = [];
  },
}));
