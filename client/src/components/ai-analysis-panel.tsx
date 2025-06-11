import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Tag, Palette, Shirt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface AnalysisResult {
  id: number;
  name: string;
  category: string;
  subcategory: string;
  style: string;
  colors: string[];
  useCase: string;
  stylingTips: string;
}

interface AnalysisResponse {
  message: string;
  processedCount: number;
  results: AnalysisResult[];
}

export function AIAnalysisPanel() {
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const analysisMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/clothing-items/analyze-untagged');
      return response.json();
    },
    onSuccess: (data: AnalysisResponse) => {
      setAnalysisResults(data.results || []);
      
      // Refresh the clothing items list
      queryClient.invalidateQueries({ queryKey: ['/api/clothing-items'] });
      
      toast({
        title: "AI Analysis Complete",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze clothing items",
        variant: "destructive",
      });
    },
  });

  const handleAnalyzeItems = () => {
    setAnalysisResults([]);
    analysisMutation.mutate();
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Analysis & Tagging
        </CardTitle>
        <CardDescription>
          Automatically analyze untagged items to detect categories, colors, styles, and use cases
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <Button 
            onClick={handleAnalyzeItems}
            disabled={analysisMutation.isPending}
            className="flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {analysisMutation.isPending ? "Analyzing..." : "Analyze Untagged Items"}
          </Button>
          
          {analysisMutation.isPending && (
            <div className="flex-1">
              <Progress value={50} className="w-full" />
              <p className="text-sm text-muted-foreground mt-1">
                Running AI analysis on clothing items...
              </p>
            </div>
          )}
        </div>

        {analysisResults.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Analysis Results</h3>
            <div className="grid gap-4">
              {analysisResults.map((result) => (
                <Card key={result.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <h4 className="font-medium">{result.name}</h4>
                      
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Shirt className="h-3 w-3" />
                          {result.category}
                        </Badge>
                        
                        {result.subcategory && (
                          <Badge variant="outline" className="flex items-center gap-1">
                            <Tag className="h-3 w-3" />
                            {result.subcategory}
                          </Badge>
                        )}
                        
                        <Badge variant="outline">
                          {result.style}
                        </Badge>
                        
                        <Badge variant="outline">
                          {result.useCase}
                        </Badge>
                      </div>

                      {result.colors.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Palette className="h-4 w-4 text-muted-foreground" />
                          <div className="flex gap-1">
                            {result.colors.map((color, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {color}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {result.stylingTips && (
                        <p className="text-sm text-muted-foreground">
                          <strong>Styling:</strong> {result.stylingTips}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="text-sm text-muted-foreground space-y-1">
          <p><strong>What this analysis detects:</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Item category (tops, bottoms, shoes, accessories, etc.)</li>
            <li>Specific subcategory (t-shirt, jeans, sneakers, etc.)</li>
            <li>Use case (formal, casual, business, sporty)</li>
            <li>Color analysis with dominant and accent colors</li>
            <li>Style classification and recommendations</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}