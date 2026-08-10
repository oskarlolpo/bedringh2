use std::mem;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub struct JobObject(pub HANDLE);

unsafe impl Send for JobObject {}
unsafe impl Sync for JobObject {}

impl JobObject {
    pub fn new() -> crate::Result<Self> {
        unsafe {
            let h_job = CreateJobObjectW(None, None)
                .map_err(|e| crate::error::ErrorKind::OtherError(e.to_string()))?;
            let mut limit_info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
            limit_info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            
            SetInformationJobObject(
                h_job,
                JobObjectExtendedLimitInformation,
                &limit_info as *const _ as _,
                mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ).map_err(|e| crate::error::ErrorKind::OtherError(e.to_string()))?;
            
            Ok(Self(h_job))
        }
    }

    pub fn assign_process(&self, h_process: HANDLE) -> crate::Result<()> {
        unsafe {
            AssignProcessToJobObject(self.0, h_process)
                .map_err(|e| crate::error::ErrorKind::OtherError(e.to_string()))?;
            Ok(())
        }
    }
}

impl Drop for JobObject {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
