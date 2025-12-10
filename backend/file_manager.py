import os
import json
import shutil
from pathlib import Path
from typing import List, Dict, Tuple
import asyncio

class FileManager:
    """Manages file operations for MCQ database"""
    
    def __init__(self, classified_path: str, final_path: str, removed_path: str):
        self.classified_path = Path(classified_path)
        self.final_path = Path(final_path)
        self.removed_path = Path(removed_path)
        # Calculate project root (parent of classified_path's parent)
        # classified_path is like: project_root/classified_all_db
        self.project_root = self.classified_path.parent
    
    def get_subjects(self) -> List[Dict]:
        """Get list of subjects with their status"""
        subjects = []
        
        if not self.classified_path.exists():
            return subjects
        
        for folder in sorted(self.classified_path.iterdir()):
            if folder.is_dir():
                json_files = list(folder.glob("*.json"))
                subjects.append({
                    "name": folder.name,
                    "enabled": len(json_files) > 0,
                    "file_count": len(json_files)
                })
        
        return subjects
    
    def load_mcq_files(self, subject: str) -> Dict[str, Dict]:
        """Load all MCQ files for a subject"""
        subject_path = self.classified_path / subject
        mcqs = {}
        corrupted_files = []
        
        if not subject_path.exists():
            return mcqs
        
        for json_file in subject_path.glob("*.json"):
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    mcqs[json_file.name] = data
            except Exception as e:
                corrupted_files.append(json_file.name)
        
        # Silently skip corrupted files
        
        return mcqs
    
    def extract_statements(self, mcqs: Dict[str, Dict]) -> Dict[str, str]:
        """Extract statements from MCQ files"""
        statements = {}
        
        for filename, data in mcqs.items():
            try:
                # Try to get statement from mcq array first
                if "mcq" in data and len(data["mcq"]) > 0:
                    statement = data["mcq"][0].get("statement", "")
                else:
                    # Fallback to root level statement
                    statement = data.get("statement", "")
                
                if statement:
                    statements[filename] = statement
            except Exception as e:
                pass  # Silently skip files without statements
        
        return statements
    
    def copy_all_files(self, subject: str) -> Tuple[int, List[str]]:
        """Copy all files from classified_db to final_db"""
        source_path = self.classified_path / subject
        dest_path = self.final_path / subject
        
        # Create destination directory
        dest_path.mkdir(parents=True, exist_ok=True)
        
        copied_files = []
        errors = []
        
        for json_file in source_path.glob("*.json"):
            try:
                dest_file = dest_path / json_file.name
                shutil.copy2(json_file, dest_file)
                copied_files.append(json_file.name)
            except Exception as e:
                errors.append(f"{json_file.name}: {e}")
        
        return len(copied_files), errors
    
    def move_file(self, subject: str, filename: str, to_removed: bool) -> bool:
        """Move file between final_db and removed_db"""
        try:
            if to_removed:
                # Move from final to removed
                source = self.final_path / subject / filename
                dest_dir = self.removed_path / subject
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / filename
                
                if source.exists():
                    shutil.move(str(source), str(dest))
                    return True
            else:
                # Move from removed to final
                source = self.removed_path / subject / filename
                dest_dir = self.final_path / subject
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / filename
                
                if source.exists():
                    shutil.move(str(source), str(dest))
                    return True
            
            return False
        except Exception as e:
            return False
    
    def copy_file_to_final(self, subject: str, filename: str) -> bool:
        """Copy file from classified_db to final_db"""
        try:
            source = self.classified_path / subject / filename
            dest_dir = self.final_path / subject
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / filename
            
            if source.exists() and not dest.exists():
                shutil.copy2(str(source), str(dest))
                return True
            return False
        except Exception as e:
            return False
    
    def get_file_status(self, subject: str, filename: str) -> str:
        """Get current status of file (saved/removed/unknown)"""
        final_file = self.final_path / subject / filename
        removed_file = self.removed_path / subject / filename
        classified_file = self.classified_path / subject / filename
        
        # Priority: removed > saved > unknown (removed takes priority if file exists in both)
        if removed_file.exists():
            return "removed"
        elif final_file.exists():
            return "saved"
        elif classified_file.exists():
            return "unknown"
        else:
            return "unknown"
    
    def get_statistics(self, subject: str) -> Dict:
        """Get statistics for subject"""
        final_dir = self.final_path / subject
        removed_dir = self.removed_path / subject
        
        final_count = len(list(final_dir.glob("*.json"))) if final_dir.exists() else 0
        removed_count = len(list(removed_dir.glob("*.json"))) if removed_dir.exists() else 0
        
        return {
            "final_count": final_count,
            "removed_count": removed_count,
            "total_count": final_count + removed_count
        }
    
    def clear_subject_files(self, subject: str) -> Tuple[int, int]:
        """Clear all files from final-db and removed_duplicates_db for a subject"""
        final_dir = self.final_path / subject
        removed_dir = self.removed_path / subject
        
        final_deleted = 0
        removed_deleted = 0
        
        # Delete all files from final-db
        if final_dir.exists():
            for json_file in final_dir.glob("*.json"):
                try:
                    json_file.unlink()
                    final_deleted += 1
                except Exception:
                    pass
        
        # Delete all files from removed_duplicates_db
        if removed_dir.exists():
            for json_file in removed_dir.glob("*.json"):
                try:
                    json_file.unlink()
                    removed_deleted += 1
                except Exception:
                    pass
        
        # Remove directories if they're empty (optional cleanup)
        try:
            if final_dir.exists() and not any(final_dir.iterdir()):
                final_dir.rmdir()
        except Exception:
            pass
        
        try:
            if removed_dir.exists() and not any(removed_dir.iterdir()):
                removed_dir.rmdir()
        except Exception:
            pass
        
        return final_deleted, removed_deleted
    
    def load_mcq_data(self, subject: str, filename: str) -> Dict:
        """Load MCQ data from file"""
        # Try final_db first, then removed_db, then classified_db
        paths = [
            self.final_path / subject / filename,
            self.removed_path / subject / filename,
            self.classified_path / subject / filename
        ]
        
        for path in paths:
            if path.exists():
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        return json.load(f)
                except Exception as e:
                    pass
        
        return {}
    
    def save_removed_tracking(self, subject: str) -> List[str]:
        """Save list of removed files to tracking JSON file (merges with existing tracking)"""
        removed_dir = self.removed_path / subject
        tracking_path = self.project_root / "removed-track"
        tracking_file = tracking_path / f"{subject}.json"
        
        # Create tracking directory if it doesn't exist
        tracking_path.mkdir(parents=True, exist_ok=True)
        
        # Load existing tracking file first (preserve history)
        existing_removed = set(self.load_removed_tracking(subject))
        print(f"[FileManager] Found {len(existing_removed)} files in existing tracking")
        
        # Get current removed files from removed_duplicates_db
        current_removed = set()
        if removed_dir.exists():
            current_removed = {f.name for f in removed_dir.glob("*.json")}
        print(f"[FileManager] Found {len(current_removed)} files currently in removed_duplicates_db")
        
        # Merge: combine existing + current (union) to preserve all removed files
        all_removed = existing_removed.union(current_removed)
        print(f"[FileManager] Merged total: {len(all_removed)} removed files (existing: {len(existing_removed)}, current: {len(current_removed)}, new: {len(current_removed - existing_removed)})")
        
        # Convert to sorted list for consistent ordering and JSON serialization
        removed_files = sorted(list(all_removed))
        
        # Save merged list to JSON file
        try:
            with open(tracking_file, 'w', encoding='utf-8') as f:
                json.dump(removed_files, f, indent=2)
            print(f"[FileManager] Saved {len(removed_files)} removed files to tracking: {tracking_file}")
        except Exception as e:
            print(f"[FileManager] Error saving tracking file: {e}")
        
        return removed_files
    
    def load_removed_tracking(self, subject: str) -> List[str]:
        """Load list of removed files from tracking JSON file"""
        tracking_file = self.project_root / "removed-track" / f"{subject}.json"
        
        if not tracking_file.exists():
            return []
        
        try:
            with open(tracking_file, 'r', encoding='utf-8') as f:
                removed_files = json.load(f)
                if isinstance(removed_files, list):
                    return removed_files
                return []
        except Exception as e:
            print(f"[FileManager] Error loading tracking file: {e}")
            return []
    
    def get_preparation_stats(self, subject: str) -> Dict:
        """Get statistics about files before preparation (for display)"""
        working_path = self.classified_path / subject
        
        if not working_path.exists():
            return {
                "total_files": 0,
                "removed_files": 0,
                "files_to_process": 0
            }
        
        # Count total files in current working folder
        total_files = len(list(working_path.glob("*.json")))
        
        # Load removed files list
        removed_files = self.load_removed_tracking(subject)
        removed_count = len(removed_files)
        
        # Files to process = total - removed
        files_to_process = total_files - removed_count
        
        return {
            "total_files": total_files,
            "removed_files": removed_count,
            "files_to_process": files_to_process
        }
    
    def prepare_subject_for_sbert(self, subject: str) -> Tuple[int, int]:
        """Copy non-removed files from original folder to working folder, using removed-track to filter"""
        working_path = self.classified_path / subject
        backup_path = self.project_root / "classified_all_db_backup" / subject
        original_path = self.project_root / "classified_all_db-original" / subject
        
        # Step 0: Delete all files in backup folder FIRST (before anything else)
        backup_path.mkdir(parents=True, exist_ok=True)
        print(f"[FileManager] Step 0: Deleting all files in backup folder: {backup_path}")
        backup_deleted_count = 0
        for existing_file in backup_path.glob("*.json"):
            try:
                existing_file.unlink()
                backup_deleted_count += 1
            except Exception as e:
                print(f"[FileManager] Warning: Failed to delete {existing_file.name} from backup: {e}")
        print(f"[FileManager] Deleted {backup_deleted_count} files from backup folder")
        
        # Check if original folder exists
        if not original_path.exists():
            raise FileNotFoundError(f"Original folder not found: {original_path}. Cannot proceed with preparation.")
        
        if not any(original_path.glob("*.json")):
            raise FileNotFoundError(f"No JSON files found in original folder: {original_path}")
        
        # Step 1: Backup current working folder (always overwrite)
        print(f"[FileManager] Step 1: Backing up current working folder to: {backup_path}")
        backup_count = 0
        if working_path.exists():
            for json_file in working_path.glob("*.json"):
                try:
                    shutil.copy2(json_file, backup_path / json_file.name)
                    backup_count += 1
                except Exception as e:
                    print(f"[FileManager] Warning: Failed to backup {json_file.name}: {e}")
        print(f"[FileManager] Backed up {backup_count} files to backup folder")
        
        # Step 2: Clear working folder
        print(f"[FileManager] Step 2: Clearing working folder: {working_path}")
        if working_path.exists():
            for json_file in working_path.glob("*.json"):
                try:
                    json_file.unlink()
                except Exception as e:
                    print(f"[FileManager] Warning: Failed to remove {json_file.name}: {e}")
        
        # Step 3: Load removed files list
        removed_files = set(self.load_removed_tracking(subject))
        print(f"[FileManager] Step 3: Found {len(removed_files)} removed files to exclude from original folder")
        
        # Step 4: Copy only non-removed files from original folder to working folder
        print(f"[FileManager] Step 4: Copying non-removed files from original folder: {original_path}")
        working_path.mkdir(parents=True, exist_ok=True)
        
        copied_count = 0
        skipped_count = 0
        
        for json_file in original_path.glob("*.json"):
            if json_file.name in removed_files:
                skipped_count += 1
                continue
            
            try:
                dest_file = working_path / json_file.name
                shutil.copy2(json_file, dest_file)
                copied_count += 1
            except Exception as e:
                print(f"[FileManager] Error copying {json_file.name}: {e}")
                skipped_count += 1
        
        print(f"[FileManager] Prepared subject for SBERT: {copied_count} copied from original, {skipped_count} skipped (removed)")
        return copied_count, skipped_count

