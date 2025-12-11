import sys
import io

# Fix Windows console encoding to support Unicode characters
if sys.platform == 'win32':
    # Set UTF-8 encoding for stdout and stderr on Windows
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    else:
        # Fallback for older Python versions
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
import json
import os
from pathlib import Path
from dotenv import load_dotenv
import asyncio

from sbert_processor import SBERTProcessor
from file_manager import FileManager
from cache_manager import CacheManager
from session_manager import SessionManager
from groups_manager import GroupsManager

# Load environment variables
load_dotenv()

app = FastAPI(title="MCQ Deduplication API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
BACKEND_PORT = int(os.getenv("BACKEND_PORT", 8000))
FRONTEND_PORT = int(os.getenv("PORT", 3009))
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", 0.85))

# Get project root directory (parent of backend folder)
PROJECT_ROOT = Path(__file__).parent.parent

# Use environment variables if set, otherwise use relative paths from project root
CLASSIFIED_DB_PATH = os.getenv("CLASSIFIED_DB_PATH", str(PROJECT_ROOT / "classified_all_db"))
FINAL_DB_PATH = os.getenv("FINAL_DB_PATH", str(PROJECT_ROOT / "final-db"))
REMOVED_DB_PATH = os.getenv("REMOVED_DB_PATH", str(PROJECT_ROOT / "removed_duplicates_db"))

# Initialize managers
file_manager = FileManager(CLASSIFIED_DB_PATH, FINAL_DB_PATH, REMOVED_DB_PATH)
cache_manager = CacheManager()
sbert_processor = SBERTProcessor(threshold=SIMILARITY_THRESHOLD)
session_manager = SessionManager()
groups_manager = GroupsManager()

# Session storage
sessions = {}

# Models
class ProcessRequest(BaseModel):
    subject: str

class SaveAllRequest(BaseModel):
    subject: str

class ProcessRequest(BaseModel):
    subject: str

class ToggleMCQRequest(BaseModel):
    subject: str
    filename: str
    checked: bool

class SubmitGroupRequest(BaseModel):
    subject: str
    group_index: int
    checked_files: List[str]

class BatchStatusRequest(BaseModel):
    subject: str
    filenames: List[str]

class BatchMCQDataRequest(BaseModel):
    subject: str
    filenames: List[str]

# API Endpoints

@app.get("/")
async def root():
    return {"message": "MCQ Deduplication API", "status": "running"}

@app.get("/api/session/{subject}")
async def check_session(subject: str):
    """Check if session exists for subject - optimized to return quickly"""
    import time
    start_time = time.time()
    try:
        # Check if removed-track JSON exists
        tracking_file = file_manager.project_root / "removed-track" / f"{subject}.json"
        has_removed_track = tracking_file.exists()
        
        # Check if session file exists first (fast file system check)
        session_exists = session_manager.session_exists(subject)
        
        # If neither exists, return False
        if not session_exists and not has_removed_track:
            return {"exists": False, "has_removed_track": False}
        
        # If only removed-track exists, return that info
        if not session_exists and has_removed_track:
            return {"exists": False, "has_removed_track": True}
        
        # Load only metadata (no groups - fast!)
        # Run in thread pool to avoid blocking event loop
        import asyncio
        loop = asyncio.get_event_loop()
        
        def load_metadata():
            return session_manager.load_session_metadata_only(subject)
        
        session_metadata = await loop.run_in_executor(None, load_metadata)
        
        if session_metadata:
            # Check if groups exist (separate file or old session)
            has_groups = groups_manager.groups_exist(subject)
            if not has_groups:
                # Check old session file for groups (backward compatibility)
                full_session = session_manager.load_session(subject)
                has_groups = full_session and ("groups_pairwise" in full_session or "groups" in full_session)
            
            session_metadata["has_groups"] = has_groups
            elapsed = time.time() - start_time
            return {
                "exists": True,
                "has_removed_track": has_removed_track,
                "session": session_metadata
            }
        
        # Session file exists but no metadata - return with removed-track info
        return {"exists": False, "has_removed_track": has_removed_track}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/subjects")
async def get_subjects():
    """Get list of available subjects"""
    try:
        subjects = file_manager.get_subjects()
        return {"subjects": subjects}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/process/{subject}")
async def process_subject(subject: str):
    """Process subject with SBERT and auto-save non-duplicates"""
    try:
        # Load MCQ files
        mcqs = file_manager.load_mcq_files(subject)
        
        if not mcqs:
            raise HTTPException(status_code=404, detail=f"No files found for subject: {subject}")
        
        total_files = len(mcqs)
        
        # Extract statements
        statements = file_manager.extract_statements(mcqs)
        
        # Check for cached embeddings
        cached_data = cache_manager.load_embeddings(subject)
        cached_embeddings = cached_data.get("embeddings") if cached_data else None
        
        # Process with SBERT
        print(f"[MAIN] Starting SBERT processing for {subject} ({total_files:,} files)", flush=True)
        loop = asyncio.get_event_loop()
        
        def process():
            import warnings
            import sys
            from io import StringIO
            
            # Suppress meta tensor errors during processing
            old_stderr = sys.stderr
            stderr_capture = StringIO()
            
            try:
                # Redirect stderr to capture meta tensor errors
                sys.stderr = stderr_capture
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    result = sbert_processor.process_subject(statements, cached_embeddings, None)
                return result
            finally:
                # Restore stderr
                sys.stderr = old_stderr
                # Check if there were meta tensor errors (but don't fail)
                stderr_output = stderr_capture.getvalue()
                if 'meta tensor' in stderr_output.lower() or 'Cannot copy out of meta tensor' in stderr_output:
                    print("Note: Meta tensor warning suppressed (model is functional)")
        
        print(f"[MAIN] Processing started...", flush=True)
        embeddings, groups_pairwise, non_duplicate_count, similarity_bins = await loop.run_in_executor(None, process)
        print(f"[MAIN] Processing completed!", flush=True)
        
        if not embeddings:
            raise HTTPException(status_code=500, detail="Processing stopped or failed")
        
        # Cache embeddings
        cache_manager.save_embeddings(subject, {"embeddings": embeddings})
        
        # Save groups separately (not in session file)
        groups_manager.save_groups(subject, groups_pairwise)
        
        # Store session data (metadata only, no groups)
        session_data = {
            "total_files": total_files,
            "non_duplicate_count": non_duplicate_count,
            "files_in_groups": sum(len(g["files"]) for g in groups_pairwise),
            "completed_groups": [],
            "files_saved": False
        }
        
        # Store full data in memory (includes groups for fast access)
        sessions[subject] = {
            **session_data,
            "groups": groups_pairwise,
            "groups_pairwise": groups_pairwise
        }
        
        # Save session to file (metadata only, no groups)
        session_manager.save_session(subject, session_data)
        
        # Auto-save non-duplicate files (files not in any group)
        # IMPORTANT: Track duplicates correctly - files in ANY group are duplicates
        files_in_groups = set()
        total_files_in_groups_count = 0
        for group in groups_pairwise:
            group_files = group["files"]
            files_in_groups.update(group_files)
            total_files_in_groups_count += len(group_files)
        
        # Only save files that are NOT in any group (non-duplicates)
        non_duplicate_files = [f for f in statements.keys() if f not in files_in_groups]
        
        # Detailed logging for tracking
        print("=" * 60)
        print("NON-DUPLICATE TRACKING LOGIC:")
        print("=" * 60)
        print(f"Total files processed: {total_files}")
        print(f"Number of duplicate groups: {len(groups_pairwise)}")
        print(f"Total file appearances in groups: {total_files_in_groups_count}")
        print(f"Unique files in groups (DUPLICATES): {len(files_in_groups)}")
        print(f"Files NOT in any group (NON-DUPLICATES): {len(non_duplicate_files)}")
        print(f"Math check: {len(files_in_groups)} + {len(non_duplicate_files)} = {len(files_in_groups) + len(non_duplicate_files)} (should equal {total_files})")
        print("=" * 60)
        
        # Verify math
        if len(files_in_groups) + len(non_duplicate_files) != total_files:
            print(f"ERROR: Math doesn't add up! Missing {total_files - (len(files_in_groups) + len(non_duplicate_files))} files")
        
        auto_saved_count = 0
        already_saved_count = 0
        errors = []
        
        # Ensure final_db base directory and subject folder exist
        file_manager.final_path.mkdir(parents=True, exist_ok=True)
        dest_dir = file_manager.final_path / subject
        dest_dir.mkdir(parents=True, exist_ok=True)
        
        # IMPORTANT: Only copy non-duplicate files (files NOT in any group)
        import shutil
        for filename in non_duplicate_files:
            try:
                source = file_manager.classified_path / subject / filename
                dest = dest_dir / filename
                
                if not source.exists():
                    errors.append(f"{filename}: source file not found")
                    continue
                
                if dest.exists():
                    already_saved_count += 1
                else:
                    # Copy file
                    shutil.copy2(str(source), str(dest))
                    # Verify copy succeeded
                    if dest.exists() and dest.stat().st_size > 0:
                        auto_saved_count += 1
                    else:
                        errors.append(f"{filename}: copy verification failed")
            except Exception as e:
                errors.append(f"{filename}: {e}")
                if len(errors) <= 3:
                    import traceback
                    traceback.print_exc()
        
        # Verify final count and ensure no duplicates were saved
        final_dir = file_manager.final_path / subject
        actual_files = list(final_dir.glob("*.json")) if final_dir.exists() else []
        actual_file_count = len(actual_files)
        saved_filenames = {f.name for f in actual_files}
        
        # Double-check: verify no files in groups were saved
        incorrectly_saved = saved_filenames.intersection(files_in_groups)
        if incorrectly_saved:
            print(f"\n⚠️  WARNING: Found {len(incorrectly_saved)} duplicate files incorrectly saved!")
            print(f"   These files are in duplicate groups but were saved anyway.")
            # Remove incorrectly saved files
            for filename in incorrectly_saved:
                try:
                    (dest_dir / filename).unlink()
                    print(f"   ✓ Removed incorrectly saved duplicate: {filename}")
                except Exception as e:
                    print(f"   ✗ Failed to remove {filename}: {e}")
            actual_file_count = len(list(final_dir.glob("*.json"))) if final_dir.exists() else 0
        
        # Verify all non-duplicates were saved
        missing_non_duplicates = set(non_duplicate_files) - saved_filenames
        if missing_non_duplicates:
            print(f"\n⚠️  WARNING: {len(missing_non_duplicates)} non-duplicate files were NOT saved!")
            print(f"   First 10 missing: {list(missing_non_duplicates)[:10]}")
        
        print(f"\n✓ VERIFICATION COMPLETE:")
        print(f"   Expected non-duplicates to save: {len(non_duplicate_files)}")
        print(f"   Actually saved: {actual_file_count}")
        print(f"   Duplicates incorrectly saved: {len(incorrectly_saved)}")
        print(f"   Non-duplicates missing: {len(missing_non_duplicates)}")
        
        # Return result
        return {
            "success": True,
            "total_files": total_files,
            "non_duplicate_count": non_duplicate_count,
            "similar_count": total_files - non_duplicate_count,
            "group_count": len(groups_pairwise),
            "auto_saved_count": auto_saved_count,
            "already_saved_count": already_saved_count,
            "actual_saved_count": actual_file_count,
            "errors": len(errors),
            "error_details": errors[:10] if errors else [],
            "similarity_bins": similarity_bins
        }
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/save-all")
async def save_all_files(request: SaveAllRequest):
    """Copy all files to final-db"""
    try:
        copied_count, errors = file_manager.copy_all_files(request.subject)
        
        # Update session to mark files as saved (metadata only)
        session = session_manager.load_session(request.subject)
        if session:
            # Remove groups if present (ensure clean metadata)
            session_metadata = {k: v for k, v in session.items() 
                              if k not in ["groups", "groups_pairwise"]}
            session_metadata["files_saved"] = True
            session_manager.save_session(request.subject, session_metadata)
        
        return {
            "success": True,
            "copied_count": copied_count,
            "errors": errors
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/groups/{subject}")
async def get_groups(subject: str):
    """Get duplicate groups for subject"""
    try:
        # Try memory first
        if subject in sessions:
            session = sessions[subject]
            groups_pairwise = session.get("groups_pairwise", session.get("groups", []))
        else:
            # Load session metadata
            session_data = session_manager.load_session(subject)
            if not session_data:
                raise HTTPException(status_code=404, detail="Subject not processed yet")
            
            # Load groups from separate file
            groups_data = groups_manager.load_groups(subject)
            
            # Backward compatibility: Check if groups exist in old session file
            if not groups_data and ("groups_pairwise" in session_data or "groups" in session_data):
                groups_pairwise = session_data.get("groups_pairwise", session_data.get("groups", []))
                # Save to separate groups file
                if groups_pairwise:
                    groups_manager.save_groups(subject, groups_pairwise)
                # Remove groups from session and resave
                session_data_clean = {k: v for k, v in session_data.items() 
                                     if k not in ["groups", "groups_pairwise", "groups_connected"]}
                session_manager.save_session(subject, session_data_clean)
            elif groups_data:
                groups_pairwise = groups_data.get("groups_pairwise", [])
            else:
                raise HTTPException(status_code=404, detail="Groups not found for subject")
            
            # Store in memory for fast access
            sessions[subject] = {
                **session_data,
                "groups": groups_pairwise,
                "groups_pairwise": groups_pairwise
            }
            session = sessions[subject]
        
        return {
            "groups": groups_pairwise,
            "groups_pairwise": groups_pairwise,
            "total_files": session["total_files"],
            "non_duplicate_count": session["non_duplicate_count"],
            "completed_groups": session.get("completed_groups", []),
            "files_saved": session.get("files_saved", False)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/toggle-mcq")
async def toggle_mcq(request: ToggleMCQRequest):
    """Toggle MCQ between saved and removed"""
    try:
        # Determine direction: checked=True means save (move from removed to final)
        to_removed = not request.checked
        
        success = file_manager.move_file(request.subject, request.filename, to_removed)
        
        if not success:
            raise HTTPException(status_code=400, detail="Failed to move file")
        
        # Get new status
        status = file_manager.get_file_status(request.subject, request.filename)
        
        return {
            "success": True,
            "filename": request.filename,
            "status": status
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/submit-group")
async def submit_group(request: SubmitGroupRequest):
    """Submit group with checked/unchecked files"""
    try:
        # Load session and groups if not in memory
        if request.subject not in sessions:
            session_data = session_manager.load_session(request.subject)
            if not session_data:
                raise HTTPException(status_code=404, detail="Subject not processed")
            
            # Load groups from separate file
            groups_data = groups_manager.load_groups(request.subject)
            
            # Backward compatibility: Check old session file
            if not groups_data and ("groups_pairwise" in session_data or "groups" in session_data):
                groups_pairwise = session_data.get("groups_pairwise", session_data.get("groups", []))
                if groups_pairwise:
                    groups_manager.save_groups(request.subject, groups_pairwise)
                session_data_clean = {k: v for k, v in session_data.items() 
                                     if k not in ["groups", "groups_pairwise", "groups_connected"]}
                session_manager.save_session(request.subject, session_data_clean)
                session_data = session_data_clean
            elif groups_data:
                groups_pairwise = groups_data.get("groups_pairwise", [])
            else:
                raise HTTPException(status_code=404, detail="Groups not found")
            
            # Store in memory
            sessions[request.subject] = {
                **session_data,
                "groups": groups_pairwise,
                "groups_pairwise": groups_pairwise
            }
        
        session = sessions[request.subject]
        
        # Use pairwise groups (Mode 3)
        groups = session.get("groups_pairwise", session.get("groups", []))
        
        if request.group_index >= len(groups):
            raise HTTPException(status_code=404, detail="Group not found")
        
        group = groups[request.group_index]
        group_files = group["files"]
        
        saved_count = 0
        removed_count = 0
        moved_to_removed = 0  # Files moved FROM saved TO removed in this submission
        unchecked_from_saved = 0  # Files unchecked that were in saved folder (moved or already removed)
        newly_added_to_saved = 0  # Files newly copied to saved_db (from unknown or removed)
        newly_added_to_removed = 0  # Files newly copied to removed_db (from unknown or saved)
        
        # Track removal history
        kept_files = []
        removed_files = []
        
        # Process each file in group
        for filename in group_files:
            is_checked = filename in request.checked_files
            current_status = file_manager.get_file_status(request.subject, filename)
            
            # New behavior: Only save/remove on submit
            if is_checked:
                # File is checked - should be in final_db
                if current_status == "unknown":
                    # File is in classified_db only - COPY to final_db (don't move)
                    if file_manager.copy_file_to_final(request.subject, filename):
                        saved_count += 1
                        newly_added_to_saved += 1
                        kept_files.append(filename)
                    else:
                        # Already exists or copy failed
                        saved_count += 1
                        kept_files.append(filename)
                elif current_status == "removed":
                    # File was previously removed - MOVE from removed_db to final_db
                    source = file_manager.removed_path / request.subject / filename
                    dest_dir = file_manager.final_path / request.subject
                    dest_dir.mkdir(parents=True, exist_ok=True)
                    dest = dest_dir / filename
                    
                    # Check if already in final_db (prevent unnecessary operations)
                    if dest.exists():
                        # Already in final_db, just remove from removed_db if it exists
                        if source.exists():
                            try:
                                source.unlink()
                                print(f"Removed duplicate {filename} from removed_db (already in final_db)")
                            except Exception as e:
                                print(f"Warning: Failed to delete {filename} from removed_db: {e}")
                        saved_count += 1
                        kept_files.append(filename)
                    elif source.exists():
                        # Source exists, dest doesn't - perform move
                        import shutil
                        # Copy file from removed_db to final_db
                        shutil.copy2(str(source), str(dest))
                        # Verify copy succeeded before deleting source
                        if dest.exists() and dest.stat().st_size > 0:
                            # Delete the original from removed_db (move behavior)
                            try:
                                source.unlink()
                                print(f"Moved checked file {filename} from removed_db to final_db (deleted from removed_db)")
                            except Exception as e:
                                print(f"Warning: Failed to delete {filename} from removed_db: {e}")
                        saved_count += 1
                        newly_added_to_saved += 1
                        kept_files.append(filename)
                    else:
                        # Neither exists (shouldn't happen, but handle gracefully)
                        saved_count += 1
                        kept_files.append(filename)
                elif current_status == "saved":
                    # File already saved - no action needed
                    saved_count += 1
                    kept_files.append(filename)
            else:
                # File is unchecked - should be in removed_db
                if current_status == "saved":
                    # File was previously saved - MOVE from final_db to removed_db
                    source = file_manager.final_path / request.subject / filename
                    dest_dir = file_manager.removed_path / request.subject
                    dest_dir.mkdir(parents=True, exist_ok=True)
                    dest = dest_dir / filename
                    
                    # Check if already in removed_db (prevent unnecessary operations)
                    if dest.exists():
                        # Already in removed_db, just remove from final_db if it exists
                        if source.exists():
                            try:
                                source.unlink()
                                print(f"Removed duplicate {filename} from final_db (already in removed_db)")
                            except Exception as e:
                                print(f"Warning: Failed to delete {filename} from final_db: {e}")
                        removed_count += 1
                        unchecked_from_saved += 1
                        removed_files.append(filename)
                    elif source.exists():
                        # Source exists, dest doesn't - perform move
                        import shutil
                        # Copy file from final_db to removed_db
                        shutil.copy2(str(source), str(dest))
                        # Verify copy succeeded before deleting source
                        if dest.exists() and dest.stat().st_size > 0:
                            # Delete the original from final_db (move behavior)
                            try:
                                source.unlink()
                                print(f"Moved unchecked file {filename} from final_db to removed_db (deleted from final_db)")
                            except Exception as e:
                                print(f"Warning: Failed to delete {filename} from final_db: {e}")
                        removed_count += 1
                        moved_to_removed += 1
                        unchecked_from_saved += 1
                        newly_added_to_removed += 1
                        removed_files.append(filename)
                    else:
                        # Neither exists (shouldn't happen, but handle gracefully)
                        removed_count += 1
                        removed_files.append(filename)
                elif current_status == "removed":
                    # File already removed - no action needed
                    removed_count += 1
                    unchecked_from_saved += 1
                    removed_files.append(filename)
                elif current_status == "unknown":
                    # File is in classified_db only - COPY to removed_db (don't move)
                    # Create removed_db folder if needed and copy file there
                    source = file_manager.classified_path / request.subject / filename
                    dest_dir = file_manager.removed_path / request.subject
                    dest_dir.mkdir(parents=True, exist_ok=True)
                    dest = dest_dir / filename
                    
                    # Only copy if dest doesn't exist (prevent unnecessary overwrites)
                    if source.exists() and not dest.exists():
                        import shutil
                        # Copy file from classified_db to removed_db (keep original in classified_db)
                        shutil.copy2(str(source), str(dest))
                        removed_count += 1
                        newly_added_to_removed += 1
                        removed_files.append(filename)
                        print(f"Copied unchecked file {filename} from classified_db to removed_db")
                    elif dest.exists():
                        # Already copied, just count it
                        removed_count += 1
                        removed_files.append(filename)
                    else:
                        # Source doesn't exist (shouldn't happen, but handle gracefully)
                        removed_count += 1
                        removed_files.append(filename)
        
        # Mark group as completed in session (metadata only)
        session = session_manager.load_session(request.subject)
        if session:
            # Remove groups if present (shouldn't be, but ensure clean metadata)
            session_metadata = {k: v for k, v in session.items() 
                              if k not in ["groups", "groups_pairwise", "groups_connected"]}
            
            if "completed_groups" not in session_metadata:
                session_metadata["completed_groups"] = []
            if request.group_index not in session_metadata["completed_groups"]:
                session_metadata["completed_groups"].append(request.group_index)
            
            # Track removal history
            if "removal_history" not in session_metadata:
                session_metadata["removal_history"] = {}
            
            # Save which files were kept/removed in this group
            for removed_file in removed_files:
                # Check if this file already has removal history
                existing_history = session_metadata.get("removal_history", {}).get(removed_file)
                existing_kept_files = existing_history.get("kept_files", []) if existing_history else []
                
                # Find files in this group that are currently saved (might be kept files)
                currently_saved_in_group = []
                for other_file in group_files:
                    if other_file != removed_file:
                        other_status = file_manager.get_file_status(request.subject, other_file)
                        if other_status == "saved":
                            currently_saved_in_group.append(other_file)
                
                # Determine which kept_files to use
                final_kept_files = []
                
                # Priority 1: Files kept in this submission
                if kept_files:
                    final_kept_files = kept_files
                # Priority 2: Existing kept_files from previous removal (preserve them)
                elif existing_kept_files:
                    final_kept_files = existing_kept_files
                # Priority 3: Other files in group that are currently saved
                elif currently_saved_in_group:
                    final_kept_files = currently_saved_in_group
                # Priority 4: Checked files in this group (even if not in saved folder yet)
                else:
                    checked_in_group = [f for f in group_files if f != removed_file and f in request.checked_files]
                    if checked_in_group:
                        final_kept_files = checked_in_group
                
                # Update removal history - always preserve existing kept_files if no new ones found
                if final_kept_files:
                    # We have kept_files (either new or preserved), update history
                    session_metadata["removal_history"][removed_file] = {
                        "group_index": request.group_index,
                        "grouped_with": group_files,
                        "kept_files": final_kept_files,
                        "removed_in_group": request.group_index if kept_files else (existing_history.get("removed_in_group", request.group_index) if existing_history else request.group_index)
                    }
                elif removed_file not in session_metadata["removal_history"]:
                    # No kept_files and no history exists, create entry (might be empty)
                    session_metadata["removal_history"][removed_file] = {
                        "group_index": request.group_index,
                        "grouped_with": group_files,
                        "kept_files": [],
                        "removed_in_group": request.group_index
                    }
                # If no kept_files but history exists, preserve existing history (don't overwrite)
                # This ensures we keep the kept_files from when file was first removed
            
            # Save only metadata (exclude groups)
            session_metadata = {k: v for k, v in session_metadata.items() 
                              if k not in ["groups", "groups_pairwise", "groups_connected"]}
            session_manager.save_session(request.subject, session_metadata)
            
            # Update in-memory session (keep groups in memory for fast access)
            if request.subject in sessions:
                sessions[request.subject].update(session_metadata)
        
        return {
            "success": True,
            "saved_count": saved_count,
            "removed_count": removed_count,
            "moved_to_removed": moved_to_removed,  # Files moved FROM saved TO removed in this submission
            "unchecked_from_saved": unchecked_from_saved,  # All files unchecked that were/are in saved folder
            "newly_added_to_saved": newly_added_to_saved,  # Files newly copied to saved_db
            "newly_added_to_removed": newly_added_to_removed  # Files newly copied to removed_db
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/mcq/{subject}/{filename}")
async def get_mcq_data(subject: str, filename: str):
    """Get MCQ data for a specific file"""
    try:
        data = file_manager.load_mcq_data(subject, filename)
        status = file_manager.get_file_status(subject, filename)
        
        # Check removal history
        removal_info = None
        kept_file_data = None
        session = session_manager.load_session(subject)
        if session and "removal_history" in session:
            if filename in session["removal_history"]:
                removal_info = session["removal_history"][filename]
                # OPTIMIZED: Load kept file data if available (to avoid second API call)
                if removal_info and "kept_files" in removal_info and len(removal_info["kept_files"]) > 0:
                    kept_filename = removal_info["kept_files"][0]
                    kept_file_data = file_manager.load_mcq_data(subject, kept_filename)
        
        return {
            "filename": filename,
            "data": data,
            "status": status,
            "removal_info": removal_info,
            "kept_file_data": kept_file_data  # OPTIMIZED: Include kept file data to avoid second API call
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/batch-file-statuses")
async def batch_file_statuses(request: BatchStatusRequest):
    """Get file statuses, removal history, and year info for multiple files at once (OPTIMIZED)"""
    try:
        # Load session once (not per file)
        session = session_manager.load_session(request.subject)
        removal_history = session.get("removal_history", {}) if session else {}
        
        results = {}
        
        # OPTIMIZED: Collect all kept filenames to batch load them
        kept_filenames_to_load = set()
        for filename in request.filenames:
            removal_info = removal_history.get(filename)
            if removal_info and "kept_files" in removal_info and len(removal_info["kept_files"]) > 0:
                kept_filenames_to_load.add(removal_info["kept_files"][0])
        
        # Batch load kept file data
        kept_files_data = {}
        for kept_filename in kept_filenames_to_load:
            kept_files_data[kept_filename] = file_manager.load_mcq_data(request.subject, kept_filename)
        
        # Batch check file statuses and year info
        for filename in request.filenames:
            status = file_manager.get_file_status(request.subject, filename)
            # Status can be: "saved", "removed", or "unknown"
            removal_info = removal_history.get(filename)
            
            # Check for year key in MCQ data (for auto-selection priority)
            mcq_data = file_manager.load_mcq_data(request.subject, filename)
            has_year = 'year' in mcq_data and mcq_data.get('year') is not None
            
            # OPTIMIZED: Include kept file data if available
            kept_file_data = None
            if removal_info and "kept_files" in removal_info and len(removal_info["kept_files"]) > 0:
                kept_filename = removal_info["kept_files"][0]
                kept_file_data = kept_files_data.get(kept_filename)
            
            
            results[filename] = {
                "status": status,  # Can be "saved", "removed", or "unknown"
                "removal_info": removal_info,
                "has_year": has_year,
                "kept_file_data": kept_file_data  # OPTIMIZED: Include kept file data to avoid second API call
            }
        
        return {
            "success": True,
            "statuses": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/batch-mcq-data")
async def batch_mcq_data(request: BatchMCQDataRequest):
    """Get MCQ data for multiple files at once (OPTIMIZED)"""
    try:
        results = {}
        
        # Batch load MCQ data for all files
        for filename in request.filenames:
            data = file_manager.load_mcq_data(request.subject, filename)
            status = file_manager.get_file_status(request.subject, filename)
            
            # Check removal history
            removal_info = None
            kept_file_data = None
            session = session_manager.load_session(request.subject)
            if session and "removal_history" in session:
                if filename in session["removal_history"]:
                    removal_info = session["removal_history"][filename]
                    # OPTIMIZED: Load kept file data if available
                    if removal_info and "kept_files" in removal_info and len(removal_info["kept_files"]) > 0:
                        kept_filename = removal_info["kept_files"][0]
                        kept_file_data = file_manager.load_mcq_data(request.subject, kept_filename)
            
            results[filename] = {
                "filename": filename,
                "data": data,
                "status": status,
                "removal_info": removal_info,
                "kept_file_data": kept_file_data
            }
        
        return {
            "success": True,
            "mcq_data": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/auto-select-best")
async def auto_select_best(request: dict):
    """Auto-select best MCQ from a group based on year and filename"""
    try:
        subject = request.get("subject")
        files = request.get("files", [])
        
        if not files:
            return {"best_file": None}
        
        # Load data for all files
        file_data = []
        for filename in files:
            data = file_manager.load_mcq_data(subject, filename)
            has_year = 'year' in data
            # Extract number from filename
            num = int(''.join(filter(str.isdigit, filename)) or '999999')
            file_data.append({
                "filename": filename,
                "has_year": has_year,
                "file_num": num
            })
        
        # Sort: year first, then smallest filename
        file_data.sort(key=lambda x: (not x["has_year"], x["file_num"]))
        
        return {"best_file": file_data[0]["filename"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/summary/{subject}")
async def get_summary(subject: str):
    """Get final summary statistics"""
    try:
        stats = file_manager.get_statistics(subject)
        
        session_data = sessions.get(subject, {})
        
        return {
            "total_processed": session_data.get("total_files", 0),
            "non_duplicates": session_data.get("non_duplicate_count", 0),
            "files_in_groups": session_data.get("files_in_groups", 0),
            "final_saved": stats["final_count"],
            "final_removed": stats["removed_count"],
            "total_files": stats["total_count"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/stop/{subject}")
async def stop_processing(subject: str):
    """Stop SBERT processing"""
    try:
        sbert_processor.stop()
        return {"success": True, "message": "Processing stopped"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/session/{subject}")
async def clear_session(subject: str):
    """Clear session data, cache, and all files for subject (complete reset)"""
    try:
        # Clear in-memory session
        if subject in sessions:
            del sessions[subject]
        
        # Clear session file
        session_manager.clear_session(subject)
        
        # Clear cache
        cache_manager.clear_cache(subject)
        
        # Delete all files from final-db and removed_duplicates_db
        final_deleted, removed_deleted = file_manager.clear_subject_files(subject)
        
        
        return {
            "success": True,
            "final_deleted": final_deleted,
            "removed_deleted": removed_deleted,
            "message": f"Cleared {final_deleted + removed_deleted} files"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/track-removed/{subject}")
async def track_removed(subject: str):
    """Track removed files by saving their list to removed-track/{subject}.json"""
    try:
        removed_files = file_manager.save_removed_tracking(subject)
        return {
            "success": True,
            "removed_count": len(removed_files),
            "removed_files": removed_files,
            "message": f"Tracked {len(removed_files)} removed files"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/preparation-stats/{subject}")
async def get_preparation_stats(subject: str):
    """Get statistics about files before preparation (total, removed, to process)"""
    try:
        stats = file_manager.get_preparation_stats(subject)
        return {
            "success": True,
            **stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/prepare-and-process/{subject}")
async def prepare_and_process(subject: str, resume_sbert: bool = Query(False)):
    """Prepare subject for SBERT by copying non-removed files, then run SBERT"""
    try:
        if not resume_sbert:
            raise HTTPException(status_code=400, detail="resume_sbert parameter must be true")
        
        # Clear session, cache, groups, final-db, and removed-db (same as Start Again)
        print(f"[MAIN] Clearing session, cache, groups, and databases for {subject}...")
        
        # Clear in-memory session
        if subject in sessions:
            del sessions[subject]
        
        # Clear session file
        session_manager.clear_session(subject)
        
        # Clear cache
        cache_manager.clear_cache(subject)
        
        # Clear groups
        groups_manager.clear_groups(subject)
        
        # Delete all files from final-db and removed_duplicates_db
        final_deleted, removed_deleted = file_manager.clear_subject_files(subject)
        print(f"[MAIN] Cleared {final_deleted} files from final-db, {removed_deleted} files from removed-db")
        
        # Prepare subject: copy non-removed files from master copy to working folder
        print(f"[MAIN] Preparing subject {subject} for SBERT (excluding removed files)...")
        copied_count, skipped_count = file_manager.prepare_subject_for_sbert(subject)
        
        if copied_count == 0:
            raise HTTPException(status_code=404, detail=f"No files to process for subject: {subject}")
        
        print(f"[MAIN] Prepared {copied_count} files, skipped {skipped_count} removed files")
        
        # Now call Option 1's process_subject() function to run SBERT
        print(f"[MAIN] Running SBERT processing on prepared files...")
        result = await process_subject(subject)
        
        # Merge preparation stats with SBERT result
        return {
            **result,
            "copied_count": copied_count,
            "skipped_count": skipped_count,
            "auto_saved": result.get("auto_saved_count", 0),
            "message": f"Processed {result.get('total_files', 0)} files (skipped {skipped_count} removed files)"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=BACKEND_PORT)

