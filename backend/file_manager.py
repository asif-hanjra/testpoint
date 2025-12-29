import os
import json
import shutil
from pathlib import Path
from typing import List, Dict, Tuple
import asyncio

class FileManager:
    """Manages file operations for MCQ database"""
    
    def __init__(self, classified_path: str, final_path: str = None, removed_path: str = None):
        self.classified_path = Path(classified_path)
        # final_path and removed_path are deprecated but kept for backward compatibility
        self.final_path = Path(final_path) if final_path else None
        self.removed_path = Path(removed_path) if removed_path else None
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
    
    # Obsolete functions removed: copy_all_files, move_file, copy_file_to_final
    # Now using final-track JSON instead of copying files to final-db
    
    def get_file_status(self, subject: str, filename: str) -> str:
        """Get current status of file (saved/removed/unknown)
        
        Priority: final-track (removed) > saved-track > unknown
        Note: final-track now stores removed files (changed from saved files)
        """
        # Check all tracking files
        removed_files = set(self.load_removed_tracking(subject))  # Reads from final-track
        saved_files = set(self.load_saved_tracking(subject))
        
        # Priority: removed (from final-track) > saved > unknown
        if filename in removed_files:
            return "removed"
        elif filename in saved_files:
            return "saved"
        else:
            return "unknown"
    
    def get_statistics(self, subject: str) -> Dict:
        """Get statistics for subject from tracking JSON files
        Note: final-track now stores removed files (changed from saved files)
        """
        # Count from tracking JSONs (no file system access needed)
        saved_files = self.load_saved_tracking(subject)
        removed_files = self.load_removed_tracking(subject)  # Reads from final-track
        
        # Total saved = saved-track only (final-track is now for removed files)
        final_count = len(saved_files)
        removed_count = len(removed_files)
        
        return {
            "final_count": final_count,
            "removed_count": removed_count,
            "total_count": final_count + removed_count
        }
    
    def clear_subject_files(self, subject: str) -> Tuple[int, int]:
        """Clear final-track JSON for a subject (no file deletion needed)
        Note: final-track now stores removed files (changed from saved files)
        """
        final_track_file = self.project_root / "final-track" / f"{subject}.json"
        
        removed_count = 0
        
        # Clear final-track JSON (which now stores removed files)
        if final_track_file.exists():
            try:
                # Count before clearing
                removed_files = self.load_removed_tracking(subject)  # Reads from final-track
                removed_count = len(removed_files)
                
                # Write empty list
                with open(final_track_file, 'w', encoding='utf-8') as f:
                    json.dump([], f, indent=2)
                
                print(f"[FileManager] Cleared {removed_count} removed files from final-track")
            except Exception as e:
                print(f"[FileManager] Error clearing final-track: {e}")
        
        # Return counts: (saved_count, removed_count)
        # Since we're only clearing removed files from final-track, saved_count is 0
        return 0, removed_count
    
    def load_mcq_data(self, subject: str, filename: str) -> Dict:
        """Load MCQ data from file (only from classified_db)"""
        # Load from classified_db only (single source of truth)
        path = self.classified_path / subject / filename
        
        if path.exists():
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"[FileManager] Error loading MCQ data from {path}: {e}")
        
        return {}
    
    def save_removed_tracking(self, subject: str, new_removed_files: List[str] = None) -> List[str]:
        """Save list of removed files to tracking JSON file (merges with existing tracking)
        Note: Now writes to final-track (changed from removed-track)
        """
        tracking_path = self.project_root / "final-track"
        tracking_file = tracking_path / f"{subject}.json"
        
        # Create tracking directory if it doesn't exist
        tracking_path.mkdir(parents=True, exist_ok=True)
        
        # Load existing tracking file first (preserve history)
        existing_removed = set(self.load_removed_tracking(subject))
        print(f"[FileManager] Found {len(existing_removed)} files in existing tracking")
        
        # Merge with new removed files if provided
        if new_removed_files:
            new_removed_set = set(new_removed_files)
            all_removed = existing_removed.union(new_removed_set)
            print(f"[FileManager] Merged total: {len(all_removed)} removed files (existing: {len(existing_removed)}, new: {len(new_removed_set)}, newly added: {len(new_removed_set - existing_removed)})")
        else:
            # No new files, just return existing
            all_removed = existing_removed
            print(f"[FileManager] No new removed files, keeping existing {len(all_removed)} files")
        
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
        """Load list of removed files from tracking JSON file
        Note: Now reads from final-track (changed from removed-track)
        """
        tracking_file = self.project_root / "final-track" / f"{subject}.json"
        
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
    
    def load_saved_tracking(self, subject: str) -> List[str]:
        """Load list of saved (non-duplicate) files from tracking JSON file"""
        tracking_file = self.project_root / "saved-track" / f"{subject}.json"
        
        if not tracking_file.exists():
            return []
        
        try:
            with open(tracking_file, 'r', encoding='utf-8') as f:
                saved_files = json.load(f)
                if isinstance(saved_files, list):
                    return saved_files
                return []
        except Exception as e:
            print(f"[FileManager] Error loading saved tracking file: {e}")
            return []
    
    def save_saved_tracking(self, subject: str, new_non_duplicates: List[str]) -> List[str]:
        """Save list of saved (non-duplicate) files to tracking JSON file (merges with existing, sorts by number)"""
        tracking_path = self.project_root / "saved-track"
        tracking_file = tracking_path / f"{subject}.json"
        
        # Create tracking directory if it doesn't exist
        tracking_path.mkdir(parents=True, exist_ok=True)
        
        # Load existing tracking file first (preserve history)
        existing_saved = set(self.load_saved_tracking(subject))
        print(f"[FileManager] Found {len(existing_saved)} files in existing saved tracking")
        
        # Merge: combine existing + new (union) to preserve all saved files
        new_saved_set = set(new_non_duplicates)
        all_saved = existing_saved.union(new_saved_set)
        print(f"[FileManager] Merged total: {len(all_saved)} saved files (existing: {len(existing_saved)}, new: {len(new_saved_set)}, newly added: {len(new_saved_set - existing_saved)})")
        
        # Sort by filename number (extract number from filename for proper numeric sorting)
        def extract_number(filename: str) -> int:
            """Extract number from filename like '1.json', '2.json', '10.json'"""
            try:
                # Remove .json extension and extract number
                name_without_ext = filename.replace('.json', '')
                # Extract all digits
                number_str = ''.join(filter(str.isdigit, name_without_ext))
                return int(number_str) if number_str else 999999
            except:
                return 999999
        
        # Convert to sorted list (sorted by numeric value, not string)
        saved_files = sorted(list(all_saved), key=extract_number)
        
        # Save merged and sorted list to JSON file
        try:
            with open(tracking_file, 'w', encoding='utf-8') as f:
                json.dump(saved_files, f, indent=2)
            print(f"[FileManager] Saved {len(saved_files)} saved files to tracking: {tracking_file}")
        except Exception as e:
            print(f"[FileManager] Error saving saved tracking file: {e}")
        
        return saved_files
    
    def load_final_tracking(self, subject: str) -> List[str]:
        """DEPRECATED: Load list of final (manually kept) files from tracking JSON file
        Note: final-track now stores removed files. Use load_saved_tracking() instead.
        This function is kept for backward compatibility but now returns saved-track data.
        """
        # Return saved-track data instead (final-track is now for removed files)
        return self.load_saved_tracking(subject)
    
    def save_final_tracking(self, subject: str, new_final_files: List[str]) -> List[str]:
        """DEPRECATED: Save list of final (manually kept) files to tracking JSON file
        Note: final-track now stores removed files. This now saves to saved-track instead.
        """
        # Save to saved-track instead (final-track is now for removed files)
        return self.save_saved_tracking(subject, new_final_files)
    
    def remove_from_final_tracking(self, subject: str, files_to_remove: List[str]) -> List[str]:
        """DEPRECATED: Remove files from final-track JSON
        Note: final-track now stores removed files. This now removes from saved-track instead.
        """
        # Remove from saved-track instead (final-track is now for removed files)
        tracking_file = self.project_root / "saved-track" / f"{subject}.json"
        
        if not tracking_file.exists():
            return []
        
        # Load existing tracking
        existing_saved = set(self.load_saved_tracking(subject))
        
        if not existing_saved:
            return []
        
        # Remove specified files
        files_to_remove_set = set(files_to_remove)
        updated_saved = existing_saved - files_to_remove_set
        
        print(f"[FileManager] Removing {len(files_to_remove_set)} files from saved-track (was: {len(existing_saved)}, now: {len(updated_saved)})")
        
        # Convert to sorted list
        saved_files = sorted(list(updated_saved))
        
        # Save updated list
        tracking_path = self.project_root / "saved-track"
        tracking_path.mkdir(parents=True, exist_ok=True)
        try:
            with open(tracking_file, 'w', encoding='utf-8') as f:
                json.dump(saved_files, f, indent=2)
            print(f"[FileManager] Updated saved-track: {tracking_file}")
        except Exception as e:
            print(f"[FileManager] Error updating saved tracking file: {e}")
        
        return saved_files
    
    def get_preparation_stats(self, subject: str) -> Dict:
        """Get statistics about files before preparation (for display)"""
        original_path = self.project_root / "classified_all_db-original" / subject
        
        # Count total files in master copy (original folder)
        if original_path.exists():
            total_files = len(list(original_path.glob("*.json")))
        else:
            total_files = 0
        
        # Load removed files list
        removed_files = self.load_removed_tracking(subject)
        removed_count = len(removed_files)
        
        # Load saved (finalized) files list
        saved_files = self.load_saved_tracking(subject)
        finalized_count = len(saved_files)
        
        # Files to process = total - finalized - removed
        files_to_process = total_files - finalized_count - removed_count
        if files_to_process < 0:
            files_to_process = 0
        
        return {
            "total_files": total_files,
            "finalized_files": finalized_count,
            "removed_files": removed_count,
            "files_to_process": files_to_process
        }
    
    def prepare_subject_for_sbert(self, subject: str) -> Tuple[int, int]:
        """Copy non-removed and non-saved files from original folder to working folder"""
        working_path = self.classified_path / subject
        original_path = self.project_root / "classified_all_db-original" / subject
        
        # Check if original folder exists
        if not original_path.exists():
            raise FileNotFoundError(f"Original folder not found: {original_path}. Cannot proceed with preparation.")
        
        if not any(original_path.glob("*.json")):
            raise FileNotFoundError(f"No JSON files found in original folder: {original_path}")
        
        # Step 1: Clear working folder
        print(f"[FileManager] Step 1: Clearing working folder: {working_path}")
        if working_path.exists():
            for json_file in working_path.glob("*.json"):
                try:
                    json_file.unlink()
                except Exception as e:
                    print(f"[FileManager] Warning: Failed to remove {json_file.name}: {e}")
        
        # Step 2: Load removed files list and saved files list
        removed_files = set(self.load_removed_tracking(subject))
        saved_files = set(self.load_saved_tracking(subject))
        print(f"[FileManager] Step 2: Found {len(removed_files)} removed files and {len(saved_files)} saved files to exclude from original folder")
        
        # Step 3: Copy only non-removed and non-saved files from original folder to working folder
        print(f"[FileManager] Step 3: Copying non-removed and non-saved files from original folder: {original_path}")
        working_path.mkdir(parents=True, exist_ok=True)
        
        copied_count = 0
        skipped_removed_count = 0
        skipped_saved_count = 0
        
        for json_file in original_path.glob("*.json"):
            if json_file.name in removed_files:
                skipped_removed_count += 1
                continue
            
            if json_file.name in saved_files:
                skipped_saved_count += 1
                continue
            
            try:
                dest_file = working_path / json_file.name
                shutil.copy2(json_file, dest_file)
                copied_count += 1
            except Exception as e:
                print(f"[FileManager] Error copying {json_file.name}: {e}")
                skipped_removed_count += 1
        
        skipped_count = skipped_removed_count + skipped_saved_count
        print(f"[FileManager] Prepared subject for SBERT: {copied_count} copied from original, {skipped_removed_count} skipped (removed), {skipped_saved_count} skipped (saved)")
        return copied_count, skipped_count

