import { InMemoryQuizRepository } from "@/lib/data/quizzes";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineQuizContract } from "@/tests/helpers/quiz-contract";

const data = new InMemoryDataset();

defineQuizContract("InMemoryQuizRepository", () => ({
  repo: () => new InMemoryQuizRepository(data),
  lessons: ["les_AAAAAAAAAAA1", "les_AAAAAAAAAAA2"],
  members: ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"],
  clear: async () => {
    data.quizzes = [];
    data.quizQuestions = [];
    data.quizOptions = [];
    data.quizAttempts = [];
    data.quizAttemptAnswers = [];
  },
}));
