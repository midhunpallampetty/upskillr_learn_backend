import mongoose, { Model, SortOrder } from 'mongoose';
import { CourseSchema } from '../models/schools/school.course.model';
import { getCourseModel } from '../utils/getSchoolModel';
import { CourseRequestBody } from '../types/course.request.body';
import { ICourse } from '../models/schools/types/ICourse';
import { SectionSchema } from '../models/schools/section.model';
import { VideoSchema } from '../models/schools/video.model';
import { ExamSchema } from '../models/schools/school.exam';
import { School } from '../models/school.model';
import CoursePayment from '../models/course.payment.model';
import { QuestionSchema } from '../models/question.model';
import { extractDbNameFromUrl } from '../utils/getSubdomain';
// NEW: Import the new schemas
import { StudentProgressSchema } from '../models/studentProgress.model';
import { CertificateSchema } from '../models/certificate.model';
// Import the existing Student model (not the schema)
import { Student } from '../models/student.model'; // Adjust path as needed; this is your compiled model export

export class CourseRepository {
  async createCourse(schoolName: string, data: CourseRequestBody) {
    const Course: Model<ICourse> = await getCourseModel(schoolName);
    return Course.create(data);
  }

  // repositories/course.repository.ts

  async updateCourse(
    schoolName: string,
    courseId: string,
    updateData: Partial<CourseRequestBody>
  ) {
    const db = mongoose.connection.useDb(schoolName);
    const Course = db.model<ICourse>('Course', CourseSchema);

    const updated = await Course.findByIdAndUpdate(courseId, updateData, {
      new: true,
      runValidators: true,
    });

    return updated;
  }

  async getCoursesBySchoolName(schoolName: string) {
    const db = mongoose.connection.useDb(schoolName);
    const Course: Model<ICourse> = db.model<ICourse>('Course', CourseSchema);
    return Course.find().sort({ createdAt: -1 });
  }

  async addVideosToSection(
    schoolName: string,
    sectionId: string,
    videos: {
      videoName: string;
      url: string;
      description?: string;
    }[]
  ) {
    const db = mongoose.connection.useDb(schoolName);

    const Section = db.model('Section', SectionSchema);
    const Video = db.model('Video', VideoSchema);

    const section = await Section.findById(sectionId);
    if (!section) throw new Error('❌ Section not found');

    if (section.videos.length + videos.length > 3) {
      throw new Error('❌ Each section can have up to 3 videos only');
    }

    const newVideos = await Video.insertMany(
      videos.map(video => ({
        ...video,
        section: section._id,
      }))
    );

    section.videos.push(...newVideos.map(v => v._id));
    await section.save();

    return await Section.findById(sectionId).populate('videos');
  }

  async getFilteredCourses({
    schoolName,
    search = '',
    sortBy = 'createdAt',
    sortOrder = 'desc',
    skip = 0,
    limit = 10,
  }: {
    schoolName: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    skip?: number;
    limit?: number;
  }) {
    const db = mongoose.connection.useDb(schoolName);
    const Course: Model<ICourse> = db.model<ICourse>('Course', CourseSchema);
    const Exam = db.model('Exam', ExamSchema); // Explicitly define Exam model in this DB context (adjust as per your types)

    const query: any = { isDeleted: { $ne: true } };
    if (search) {
      query.$or = [
        { courseName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }, // if you have description
      ];
    }

    const sortOptions: Record<string, SortOrder> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Fetch courses with population, filtering out deleted exams
    const courses = await Course.find(query)
      .populate({
        path: 'preliminaryExam', // Adjust path if nested
        model: Exam, // Explicitly reference the model
        match: { isDeleted: { $ne: true } }, // Optional: Skip soft-deleted exams
      })
      .populate({
        path: 'finalExam', // Adjust path if nested
        model: Exam,
        match: { isDeleted: { $ne: true } }, // Optional: Skip soft-deleted exams
      })
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);

    // Debug logging (remove in production)
    console.log('✅ Fetched courses:', courses); // Check if populated fields are now objects or still null
    if (courses.length > 0 && !courses[0].preliminaryExam) {
      console.warn('⚠️ Preliminary exam is null; verify ObjectId exists in Exam collection');
    }

    const totalCount = await Course.countDocuments(query);

    return {
      courses,
      totalCount,
    };
  }

  async getCoursesBySubdomain({
    schoolName,
    search = '',
    sortBy = 'createdAt',
    sortOrder = 'desc',
    skip = 0,
    limit = 10,
  }: {
    schoolName: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    skip?: number;
    limit?: number;
  }) {
    const db = mongoose.connection.useDb(schoolName);
    const Course: Model<ICourse> = db.model<ICourse>('Course', CourseSchema);

    const query: any = { isDeleted: { $ne: true } };
    if (search) {
      query.$or = [
        { courseName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const sortOptions: Record<string, SortOrder> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    const courses = await Course.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);
    const totalCount = await Course.countDocuments(query);

    return { courses, totalCount };
  }

  async getSectionsByCourseId(schoolName: string, courseId: string) {
    const db = mongoose.connection.useDb(schoolName);

    const Course: Model<ICourse> = db.model<ICourse>('Course', CourseSchema);
    const Section = db.model('Section', SectionSchema);
    const Video = db.model('Video', VideoSchema);
    const Exam = db.model('Exam', ExamSchema);

    const course = await Course.findById(courseId).select('sections');

    if (!course || !course.sections.length) return [];

    const sections = await Section.find({
      _id: { $in: course.sections },
      isDeleted: { $ne: true } // 🔥 Exclude soft-deleted sections
    });

    console.log(sections, 'sections');
    return sections;
  }

  async softDeleteCourse(schoolName: string, courseId: string) {
    const db = mongoose.connection.useDb(schoolName);
    const Course = db.model<ICourse>('Course', CourseSchema);

    return await Course.findByIdAndUpdate(
      courseId,
      { isDeleted: true },
      { new: true }
    );
  }

  async softDeleteSection(schoolName: string, sectionId: string) {
    const db = mongoose.connection.useDb(schoolName);
    const Section = db.model('Section', SectionSchema);

    return await Section.findByIdAndUpdate(
      sectionId,
      { isDeleted: true },
      { new: true }
    );
  }

  async getCourseById(schoolName: string, courseId: string) {
    const db = mongoose.connection.useDb(schoolName);
    const Course: Model<ICourse> = db.model<ICourse>('Course', CourseSchema);

    const course = await Course.findOne({
      _id: courseId,
      isDeleted: { $ne: true },
    }).populate({
      path: 'sections',
      populate: [{ path: 'videos' }, { path: 'exam' }],
    });

    return course;
  }

  async findById(schoolName: string, courseId: string) {
    const db = mongoose.connection.useDb(schoolName);
    const Course: Model<ICourse> = db.model<ICourse>('Course', CourseSchema);
    return await Course.findById(courseId);
  }

  async getSchoolNameAndCourseIdByStudentId(studentId: string) {
    const trimmedStudentId = studentId.trim();

    const payments = await CoursePayment.find({ studentId: trimmedStudentId });

    if (!payments || payments.length === 0) {
      throw new Error('No course payments found for the given student ID');
    }

    const courseList: { schoolName: string; course: ICourse }[] = [];
    const uniqueCourseKeys = new Set<string>();

    for (const payment of payments) {
      const { schoolId, courseId } = payment;

      const key = `${schoolId}_${courseId}`;
      if (uniqueCourseKeys.has(key)) {
        continue; // Skip duplicate
      }

      const school = await School.findById(schoolId);
      if (!school || !school.subDomain) {
        console.warn(`School or subdomain not found for schoolId: ${schoolId}`);
        continue;
      }

      const schoolName = extractDbNameFromUrl(school.subDomain);
      if (!schoolName) {
        console.warn(`Unable to extract school name from subdomain: ${school.subDomain}`);
        continue;
      }

      const db = mongoose.connection.useDb(schoolName || 'guest');

      try {
        const Course: Model<ICourse> = db.model<ICourse>('Course', CourseSchema);
        const course = await Course.findById(courseId);
        if (course) {
          courseList.push({ schoolName, course });
          uniqueCourseKeys.add(key); // Mark as seen
        } else {
          console.warn(`Course not found in ${schoolName} for courseId: ${courseId}`);
        }
      } catch (err) {
        console.error(`Error fetching course from ${schoolName}:`, err.message);
      }
    }

    return courseList;
  }

  async getCompleteCourseDetails(schoolName: string, courseId: string) {
    const db = mongoose.connection.useDb(schoolName);
    const Course = db.model('Course', CourseSchema);
    const Section = db.model('Section', SectionSchema);
    const Video = db.model('Video', VideoSchema);
    const Exam = db.model('Exam', ExamSchema);
    const Question = db.model('Question', QuestionSchema);

    // Step 1: Get course
    const course = await Course.findOne({
      _id: courseId,
      isDeleted: { $ne: true }
    });

    if (!course) throw new Error('Course not found');

    // Safeguard: Ensure sections is an array; fallback to empty if undefined
    const sectionsArray = Array.isArray(course.sections) ? course.sections : [];

    // Step 2: Populate sections with videos & exam (and exam's questions)
    const populatedSections = await Promise.all(
      sectionsArray.map(async (sectionId: any) => {
        const section = await Section.findOne({ _id: sectionId, isDeleted: { $ne: true } });
        if (!section) return null;

        // Safeguard for videos
        const videosArray = Array.isArray(section.videos) ? section.videos : [];
        const populatedVideos = await Promise.all(
          videosArray.map(async (videoId: any) => {
            const video = await Video.findOne({ _id: videoId, isDeleted: { $ne: true } });
            return video;
          })
        );

        // Populate exam (with questions)
        let populatedExam = null;
        if (section.exam) {
          const exam = await Exam.findOne({ _id: section.exam, isDeleted: { $ne: true } });
          if (exam) {
            // Safeguard for questions
            let examObj = JSON.stringify(exam)
            let parsedexamObj = JSON.parse(examObj)
            const questionsArray = Array.isArray(parsedexamObj?.questions) ? parsedexamObj?.questions : [];
            console.log('exam', parsedexamObj?.questions)

            const populatedQuestions = await Promise.all(
              questionsArray.map(async (questionId: any) => {
                const question = await Question.findOne({ _id: questionId, isDeleted: { $ne: true } });
                return question;
              })
            );

            populatedExam = {
              ...exam.toObject(),
              questions: populatedQuestions.filter(Boolean) // only non-null
            };
          }
        }
        return {
          ...section.toObject(),
          videos: populatedVideos.filter(Boolean),
          exam: populatedExam    // exam fully populated with questions
        };
      })
    );

    // Remove any null sections (not found)
    const finalCourse = {
      ...course.toObject(),
      sections: populatedSections.filter(Boolean)
    };

    return finalCourse;
  }

  async addOrUpdateCourseExam(
    schoolName: string,
    courseId: string,
    examType: 'preliminary' | 'final',
    examId: string
  ): Promise<any> {
    throw new Error('Not implemented');
  }

  // repositories/course.repository.ts
  async getCourseByIdForQuestions(schoolName: string, courseId: string) {
    const db = mongoose.connection.useDb(schoolName);
    const Course: Model<ICourse> = db.model<ICourse>('Course', CourseSchema);
    return await Course.findOne({
      _id: courseId,
      isDeleted: { $ne: true },
    }).select('preliminaryExam finalExam isPreliminaryRequired');
  }

  // repositories/course.repository.ts
  async getExamById(schoolName: string, examId: string) {
    const db = mongoose.connection.useDb(schoolName);
    const Exam = db.model('Exam', ExamSchema);
    
    const examData = await Exam.findOne({
      _id: examId,
      isDeleted: { $ne: true },
    })
    
    console.log('Exam Data:', examData); // Debug log
    return examData;
  }

  async getQuestionsByIds(schoolName: string, questionIds: string[]) {
    const db = mongoose.connection.useDb(schoolName);
    const Question = db.model('Question', QuestionSchema);
    const ids = questionIds.map(id => {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error(`Invalid question ID: ${id}`);
      }
      return new mongoose.Types.ObjectId(id);
    });
    const questions = await Question.find({
      _id: { $in: ids },
      isDeleted: { $ne: true },
    }).exec();
    console.log('Questions Fetched:', questions); // Debug log
    return questions;
  }

  // UPDATED: Get student progress (returns the progress map and passedSections)
  async getStudentProgress(schoolName: string, studentId: string, courseId: string): Promise<{
    videos: Map<string, { completed: boolean; lastPosition: number }>;
    passedSections: Array<{ sectionId: string; score: number; passedAt: Date }>;
  }> {
    const db = mongoose.connection.useDb(schoolName);
    const StudentProgress = db.model('StudentProgress', StudentProgressSchema);

    let progressDoc = await StudentProgress.findOne({ studentId, courseId });

    if (!progressDoc) {
      progressDoc = new StudentProgress({ studentId, courseId, progress: new Map(), passedSections: [] });
      await progressDoc.save();
    }

    return {
      videos: progressDoc.progress,
      passedSections: progressDoc.passedSections,
    };
  }

  // EXISTING: Update video progress
  async updateVideoProgress(
    schoolName: string,
    studentId: string,
    courseId: string,
    videoId: string,
    data: { completed?: boolean; lastPosition?: number }
  ): Promise<void> {
    const db = mongoose.connection.useDb(schoolName);
    const StudentProgress = db.model('StudentProgress', StudentProgressSchema);

    const update: any = { lastUpdated: Date.now() };

    if (data.completed !== undefined) {
      update[`progress.${videoId}.completed`] = data.completed;
    }
    if (data.lastPosition !== undefined) {
      update[`progress.${videoId}.lastPosition`] = data.lastPosition;
    }

    await StudentProgress.findOneAndUpdate(
      { studentId, courseId },
      { $set: update },
      { upsert: true, new: true }
    );
  }

  // NEW: Update section progress (for exam passes)
async updateSectionProgress(
  schoolName: string,
  studentId: string,
  courseId: string,
  sectionId: string,
): Promise<void> {
  const db = mongoose.connection.useDb(schoolName);
  const StudentProgress = db.model('StudentProgress', StudentProgressSchema);
  const Course = db.model<ICourse>('Course', CourseSchema);
  const Section = db.model('Section', SectionSchema);

  // Check if already passed to avoid duplicates
  const progressDoc = await StudentProgress.findOne({ studentId, courseId });
  if (progressDoc && progressDoc.passedSections.some(p => p.sectionId === sectionId)) {
    return; // Already passed, no-op
  }

  // Save the passed section (score optional, not passed here)
  await StudentProgress.findOneAndUpdate(
    { studentId, courseId },
    {
      $push: {
        passedSections: {
          sectionId,
          passedAt: new Date(),
        },
      },
      $set: { lastUpdated: Date.now() },
    },
    { upsert: true, new: true }
  );

  // Removed auto-marking videos to focus ONLY on exam pass
}

  // UPDATED: Check if course is completed (now accounts for passed sections)
async isCourseCompleted(schoolName: string, studentId: string, courseId: string): Promise<boolean> {
  const db = mongoose.connection.useDb(schoolName);
  const Course = db.model<ICourse>('Course', CourseSchema);
  const StudentProgress = db.model('StudentProgress', StudentProgressSchema);

  const course = await Course.findOne({ _id: courseId, isDeleted: { $ne: true } })
    .populate({
      path: 'sections',
      match: { isDeleted: { $ne: true } },
      populate: {
        path: 'videos',
        match: { isDeleted: { $ne: true } },
      },
    });

  if (!course) return false;

  const progress = await this.getStudentProgress(schoolName, studentId, courseId);
  if (!progress) return false;

  // Updated: For sections with exams, ONLY check if exam is passed (ignore videos).
  // For sections without exams, require all videos completed.
  return course.sections.every((section: any) => {
    if (section.exam) {
      return progress.passedSections.some(p => p.sectionId === section._id.toString());
    } else {
      return section.videos.every((video: any) =>
        progress.videos.get(video._id.toString())?.completed === true
      );
    }
  });
}
// repositories/course.repository.ts
async isSectionCompleted(
  schoolName: string,
  studentId: string,
  courseId: string,
  sectionId: string
): Promise<boolean> {
  const db = mongoose.connection.useDb(schoolName);
  const StudentProgress = db.model('StudentProgress', StudentProgressSchema);

  // Find student progress doc for this course/student
  const progress = await StudentProgress.findOne({ studentId, courseId });

  if (!progress) return false;

  // Check if this section is marked as passed
  return progress.passedSections.some(
    p => p.sectionId === sectionId
  );
}

  // NEW: Issue certificate (updated with real PDF generation and Cloudinary upload)
  // ... (other methods unchanged)

  // NEW: Issue certificate (updated with debugging)
  async issueCertificate(schoolName: string, studentId: string, courseId: string): Promise<string> {
    const db = mongoose.connection.useDb(schoolName);
    const Certificate = db.model('Certificate', CertificateSchema);
    const StudentModel = db.model('Student', Student.schema);
    const Course = db.model<ICourse>('Course', CourseSchema);

    try {
      console.log('Repo: Fetching data...');
      let certDoc = await Certificate.findOne({ studentId, courseId });
      if (certDoc) {
        console.log('Repo: Existing certificate:', certDoc.certificateUrl);
        return certDoc.certificateUrl;
      }

      const student = await StudentModel.findById(studentId);
      const course = await Course.findById(courseId);
      if (!student || !course) {
        throw new Error('Student or Course not found');
      }
      console.log('Repo: Data fetched successfully');

      const dateIssued = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      console.log('Repo: Starting PDF generation...');
      try {
        const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
        console.log('Repo: pdf-lib loaded');

        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([600, 400]);
        const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
        const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
        console.log('Repo: Fonts embedded');

        const { width, height } = page.getSize();
        // (Add text as before - omitted for brevity, but keep your original)

        const pdfBytes = await pdfDoc.save();
        console.log('Repo: PDF bytes generated (length:', pdfBytes.length, ')');

        const fs = require('fs');
        const path = require('path');
        const localPath = path.resolve(__dirname, `test_certificate_${studentId}.pdf`);
        fs.writeFileSync(localPath, pdfBytes);
        console.log('Repo: PDF saved locally at', localPath);

      } catch (pdfError) {
        console.error('Repo: PDF Generation Failed:', pdfError);
        // Fallback to dummy URL if generation fails (temporary)
        const certificateUrl = 'https://res.cloudinary.com/certifier/image/upload/v1729684608/templatka_blog_28_b3c94eb61e.png';
        await Certificate.create({ studentId, courseId, certificateUrl });
        return certificateUrl;
      }

      // (Cloudinary upload as before - add logs similarly)

      // Save to DB
      console.log('Repo: Saving to DB...');
      // (Your save logic)

      return "certificateUrl";
    } catch (error) {
      console.error('Repo: General Error:', error);
      throw error;
    }
  }

  async addExamToSection(schoolName: string, sectionId: string, examId: string) {
    const db = mongoose.connection.useDb(schoolName);
    const Section = db.model('Section', SectionSchema);
    const Exam = db.model('Exam', ExamSchema);

    // Check if exam exists and is not deleted
    const exam = await Exam.findOne({
      _id: examId,
      isDeleted: { $ne: true },
    });
    if (!exam) {
      throw new Error('Exam not found or deleted');
    }

    // Check if section exists and is not deleted, then update
    const section = await Section.findOne({
      _id: sectionId,
      isDeleted: { $ne: true },
    });
    if (!section) {
      throw new Error('Section not found or deleted');
    }

    section.exam = new mongoose.Types.ObjectId(examId);
    await section.save();

    // Return the updated section (optionally populate if needed, e.g., with exam details)
    return await Section.findById(sectionId).populate('exam');
  }
}
