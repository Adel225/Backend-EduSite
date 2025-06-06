import { asyncHandler } from "../../../utils/erroHandling.js";
import { assignmentModel } from "../../../../DB/models/assignment.model.js";
import { s3 } from "../../../utils/S3Client.js";
import { GetObjectCommand ,PutObjectCommand} from "@aws-sdk/client-s3";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { streamToBuffer } from "../../../utils/streamToBuffer.js";
import { PDFDocument, rgb } from "pdf-lib";
import { pagination } from "../../../utils/pagination.js";





export const GetAllByGroup = asyncHandler (async  (req, res, next) => {
  const {groupId}= req.body ;
  
  if(req.isteacher.teacher== false&& req.user.groupId ==groupId){
    return next(new Error("The Studednt no in This group", { cause: 401 }));
    ;
  }
  const ass = await assignmentModel.find({groupId:groupId});
  res.status(201).json(ass)
})



export const getSubmissionsByGroup = asyncHandler(async (req, res, next) => {
  const { groupId, assignmentId, status, page = 1, size = 10 } = req.query; // Extract parameters with defaults

  // Validate groupId
  if (!groupId) {
    return next(new Error("Group ID is required", { cause: 400 }));
  }

  try {
    // Build query filters
    const query = { groupId };

    // Filter by assignmentId if provided
    if (assignmentId) {
      // Ensure the assignment belongs to the group
      const assignment = await assignmentModel.findOne({ _id: assignmentId, groupId });
      if (!assignment) {
        return next(new Error("Invalid assignment ID for the provided group", { cause: 400 }));
      }
      query.assignmentId = assignmentId;
    }

    // Filter by status if provided
    if (status === "marked") {
      query.isMarked = true;
    } else if (status === "unmarked") {
      query.isMarked = false;
    }

    // Get pagination details
    const { limit, skip } = pagination({ page, size });

    // Fetch submissions with filtering, pagination, and sorting
    const submissions = await SubassignmentModel.find(query)
      .sort({ isMarked: 1, createdAt: -1 }) // Unmarked first, then by newest submissions
      .limit(limit)
      .skip(skip)
      .populate("studentId", "userName firstName lastName") // Populate student info
      .populate("assignmentId", "name"); // Populate assignment info

    // Count total submissions for pagination metadata
    const totalSubmissions = await SubassignmentModel.countDocuments(query);

    // Respond with the submissions and metadata
    res.status(200).json({
      message: "Submissions fetched successfully",
      totalSubmissions,
      totalPages: Math.ceil(totalSubmissions / limit),
      currentPage: parseInt(page, 10),
      submissions,
    });
  } catch (error) {
    console.error("Error fetching submissions:", error);
    return next(new Error("Failed to fetch submissions", { cause: 500 }));
  }
});

export const getSubmissions = asyncHandler(async (req, res, next) => {
  const { assignmentId, submissionId } = req.query;

  // Ensure assignmentId is provided
  if (!assignmentId) {
    return next(new Error("Assignment ID is required", { cause: 400 }));
  }

  // Fetch the assignment details to validate access
  const assignment = await assignmentModel.findById(assignmentId);
  if (!assignment) {
    return next(new Error("Assignment not found", { cause: 404 }));
  }

  // Check if the user is authorized
  const isTeacher = req.isteacher.teacher;
  const isStudentInGroup =
    !isTeacher && assignment.groupId.toString() === req.user.groupid.toString();

  if (!isTeacher && !isStudentInGroup) {
    return next(new Error("You are not authorized to view these submissions", { cause: 403 }));
  }

  // Fetch submissions
  let submissions;
  if (submissionId) {
    // Fetch a specific submission by ID
    submissions = await SubassignmentModel.findOne({
      _id: submissionId,
      assignmentId,
    }).populate("studentId", "userName firstName lastName email");

    // Ensure the submission exists and the user has access
    if (!submissions) {
      return next(new Error("Submission not found", { cause: 404 }));
    }
    if (!isTeacher && submissions.studentId._id.toString() !== req.user._id.toString()) {
      return next(new Error("You are not authorized to view this submission", { cause: 403 }));
    }
  } else {
    // Fetch all submissions for the assignment
    const { limit, skip } = pagination(req.query);
    const query = { assignmentId };

    // If the user is a student, filter by their submissions only
    if (!isTeacher) {
      query.studentId = req.user._id;
    }

    submissions = await SubassignmentModel.find(query)
      .populate("studentId", "userName firstName lastName email")
      .skip(skip)
      .limit(limit)
      .sort({ isMarked: 1, createdAt: -1 }); // Unmarked first, then by submission date
  }

  res.status(200).json({
    message: "Submissions retrieved successfully",
    submissions,
  });
});


export const getAssignmentsForStudent = asyncHandler(async (req, res, next) => {
  const { page = 1, size = 10, status } = req.query;

  const user = req.user; // The authenticated user
  const isTeacher = req.isteacher.teacher;
  const currentDate = new Date();

  try {
    const query = {};

    if (isTeacher) {
      // If the user is a teacher, fetch assignments they created or all assignments
      if (req.query.groupId && mongoose.Types.ObjectId.isValid(req.query.groupId)) {
        query.groupId = req.query.groupId; // Filter by group if specified
      }
    } else {
      // For students, filter by their group
      query.groupId = user.groupid;
    }

    // Apply timeline filters if status is provided
    if (status) {
      if (status === "active") {
        query.startDate = { $lte: currentDate };
        query.endDate = { $gte: currentDate };
      } else if (status === "upcoming") {
        query.startDate = { $gt: currentDate };
      } else if (status === "expired") {
        query.endDate = { $lt: currentDate };
      }
    }

    // Pagination helpers
    const { limit, skip } = pagination({ page, size });

    // Fetch assignments
    const assignments = await assignmentModel
      .find(query)
      .sort({ startDate: 1 }) // Sort by start date
      .skip(skip)
      .limit(limit)
      .select("name startDate endDate groupId rejectedStudents enrolledStudents") // Select specific fields
      .populate("groupId", "name"); // Populate group details

    // Total count for pagination
    const totalAssignments = await assignmentModel.countDocuments(query);

    // Response
    res.status(200).json({
      message: "Assignments fetched successfully",
      totalAssignments,
      totalPages: Math.ceil(totalAssignments / limit),
      currentPage: parseInt(page, 10),
      assignments,
    });
  } catch (error) {
    console.error("Error fetching assignments:", error);
    next(new Error("Failed to fetch assignments", { cause: 500 }));
  }
});
