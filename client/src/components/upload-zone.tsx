import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { CloudUpload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface UploadFile {
  file: File;
  name: string;
  progress: number;
  status: 'uploading' | 'analyzing' | 'complete' | 'error';
}

export function UploadZone() {
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async ({ file, name }: { file: File; name: string }) => {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('name', name);

      const response = await apiRequest('POST', '/api/clothing-items', formData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/clothing-items'] });
      queryClient.refetchQueries({ queryKey: ['/api/clothing-items'] });
      toast({
        title: "Success!",
        description: "Clothing item analyzed and added to your wardrobe.",
      });
    },
    onError: (error: any) => {
      // Handle duplicate item error specifically
      if (error.status === 409) {
        const errorData = error.data || {};
        
        if (errorData.duplicateType === "image") {
          toast({
            title: "Duplicate image detected",
            description: errorData.message || "This image has already been uploaded to your wardrobe.",
            variant: "destructive",
          });
        } else if (errorData.duplicateType === "name") {
          toast({
            title: "Duplicate name detected",
            description: "An item with this name already exists in your wardrobe. Try a different name.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Duplicate item detected",
            description: "This item already exists in your wardrobe.",
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Upload failed",
          description: error.message || "Failed to analyze clothing item.",
          variant: "destructive",
        });
      }
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select an image smaller than 10MB.",
          variant: "destructive",
        });
        return;
      }

      const uploadFile: UploadFile = {
        file,
        name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
        progress: 0,
        status: 'uploading',
      };

      setUploads(prev => [...prev, uploadFile]);

      // Simulate upload progress
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress >= 80) {
          clearInterval(progressInterval);
          setUploads(prev => prev.map(u => 
            u.file === file ? { ...u, progress: 80, status: 'analyzing' } : u
          ));

          // Start actual upload and analysis
          uploadMutation.mutate(
            { file, name: uploadFile.name },
            {
              onSuccess: () => {
                setUploads(prev => prev.map(u => 
                  u.file === file ? { ...u, progress: 100, status: 'complete' } : u
                ));
                // Remove completed upload after delay
                setTimeout(() => {
                  setUploads(prev => prev.filter(u => u.file !== file));
                }, 2000);
              },
              onError: () => {
                setUploads(prev => prev.map(u => 
                  u.file === file ? { ...u, status: 'error' } : u
                ));
              },
            }
          );
        } else {
          setUploads(prev => prev.map(u => 
            u.file === file ? { ...u, progress } : u
          ));
        }
      }, 200);
    });
  }, [uploadMutation, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp']
    },
    multiple: true,
  });

  return (
    <section className="py-16 bg-white" id="upload">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 font-serif mb-4">
            Add Your Clothes
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Drag and drop photos of your clothing items, or click to browse. Our AI will analyze each piece for color, style, and type.
          </p>
        </div>
        
        <div className="max-w-4xl mx-auto">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed transition-colors rounded-2xl p-12 text-center cursor-pointer ${
              isDragActive
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-gray-300 hover:border-indigo-500 bg-gray-50 hover:bg-indigo-50'
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-indigo-500 rounded-2xl flex items-center justify-center mb-4">
                <CloudUpload className="text-white w-8 h-8" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {isDragActive ? 'Drop your photos here' : 'Drop your photos here'}
              </h3>
              <p className="text-gray-600 mb-6">or click to browse from your device</p>
              <Button className="bg-indigo-500 hover:bg-indigo-600">
                Choose Photos
              </Button>
              <p className="text-sm text-gray-500 mt-4">Supports JPG, PNG up to 10MB each</p>
            </div>
          </div>
          
          {uploads.length > 0 && (
            <div className="mt-8 space-y-4">
              {uploads.map((upload, index) => (
                <Card key={index} className="shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">
                        {upload.name}
                      </span>
                      <div className="flex items-center space-x-2">
                        {upload.status === 'analyzing' && (
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                        )}
                        <span className="text-sm text-gray-500">
                          {upload.status === 'uploading' && `${Math.round(upload.progress)}%`}
                          {upload.status === 'analyzing' && 'AI Analyzing...'}
                          {upload.status === 'complete' && 'Complete!'}
                          {upload.status === 'error' && 'Failed'}
                        </span>
                      </div>
                    </div>
                    <Progress 
                      value={upload.progress} 
                      className={`h-2 ${upload.status === 'error' ? 'bg-red-100' : ''}`}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
